import { DurableObject } from "cloudflare:workers";
import { findChunksByJob, updateChunkTranscript } from "./repositories/chunk-repository";
import {
  claimJobForAnalyze,
  claimJobForTranscribe,
  completeJob,
  createTopics,
  deleteTopicsByJob,
  findJobById,
  markAsAnalyzeFailed,
  markAsTranscribed,
  markAsTranscribeFailed,
} from "./repositories/job-repository";
import { analyzeWithGemini } from "./services/gemini-service";
import { uploadJSON } from "./services/r2-storage";
import { transcribeChunk } from "./services/whisper-service";
import type { Bindings } from "./types";

// JobPayload travels through DO storage between alarms. The phase fields keep
// retry state isolated so a Gemini failure cannot recharge Whisper.
export type JobPayload = {
  jobId: string;
  userId: string;
  audioKey: string;
  transcribeAttempts?: number;
  analyzeAttempts?: number;
  // When set to "analyze" the orchestrator skips the transcribe phase. This is
  // how POST /api/v1/jobs/:id/analyze re-runs only the LLM step.
  startPhase?: "transcribe" | "analyze";
};

type Segment = { text: string; start_sec: number; end_sec: number };

const MAX_RETRIES = 3;
const DEFAULT_WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

// Orchestrates audio processing per job: claim → transcribe → persist → analyze
// → complete. The transcribe phase reads chunks already split client-side
// (Phase 3) directly from D1 and calls Workers AI Whisper one chunk at a time;
// the analyze phase calls Gemini from the Worker. There is no longer a Go
// container in the loop, so we drop the @cloudflare/containers base class and
// use a plain DurableObject + alarm-based scheduling.
export class KoeProcessor extends DurableObject<Bindings> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/enqueue" && request.method === "POST") {
      const job = await request.json<JobPayload>();
      await this.ctx.storage.put("job", job);
      await this.ctx.storage.setAlarm(Date.now());
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  override async alarm(): Promise<void> {
    const job = await this.ctx.storage.get<JobPayload>("job");
    if (!job) return;

    if (job.startPhase !== "analyze") {
      try {
        const next = await this.runTranscribe(job);
        // Another invocation is in-flight on transcribe; let it finish without
        // entering analyze (which would observe `transcribing` and bail).
        if (next === "stop") return;
      } catch (err) {
        await this.handleTranscribeError(job, err);
        return;
      }
    }

    try {
      await this.runAnalyze(job);
    } catch (err) {
      await this.handleAnalyzeError(job, err);
      return;
    }

    await this.ctx.storage.delete("job");
  }

  private async scheduleRetry(seconds: number): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + seconds * 1000);
  }

  private async runTranscribe(job: JobPayload): Promise<"continue" | "stop"> {
    const claimed = await claimJobForTranscribe(this.env.DB, job.jobId);
    if (!claimed) {
      const current = await findJobById(this.env.DB, job.jobId);
      // Another invocation is already transcribing this job. Back off entirely
      // so we don't flip an in-flight job to transcribe_failed via duplicate
      // enqueues / re-entrant alarms.
      if (current?.status === "transcribing") return "stop";
      // Job has already moved past transcribe. Drop through so analyze can run.
      if (
        current &&
        (current.status === "transcribed" ||
          current.status === "analyzing" ||
          current.status === "analyze_failed" ||
          current.status === "completed")
      ) {
        return "continue";
      }
      throw new Error(
        `could not claim job for transcribe (status=${current?.status ?? "unknown"})`,
      );
    }

    const chunks = await findChunksByJob(this.env.DB, job.jobId);
    if (chunks.length === 0) {
      throw new Error("no chunks found for job");
    }

    const whisperOpts = {
      baseURL: this.env.WHISPER_BASE_URL,
      apiKey: this.env.WHISPER_API_KEY,
      model: this.env.WHISPER_MODEL || DEFAULT_WHISPER_MODEL,
    };

    const allSegments: Segment[] = [];
    const chunkTexts: string[] = [];

    // Sequential by design — Workers AI has per-account concurrency limits and
    // running chunks one at a time matches the prior Go pipeline so latency /
    // back-pressure characteristics don't shift unexpectedly during this
    // refactor. Revisit if Whisper throughput becomes the bottleneck.
    for (const chunk of chunks) {
      // oxlint-disable-next-line no-await-in-loop
      const r2Object = await this.env.BUCKET.get(chunk.audioKey);
      if (!r2Object) {
        throw new Error(`chunk audio not found in R2: ${chunk.audioKey}`);
      }
      // oxlint-disable-next-line no-await-in-loop
      const audio = new Uint8Array(await r2Object.arrayBuffer());
      // oxlint-disable-next-line no-await-in-loop
      const result = await transcribeChunk(audio, whisperOpts);

      // Whisper returns chunk-local timestamps; shift onto the global timeline.
      for (const seg of result.segments) {
        allSegments.push({
          text: seg.text,
          start_sec: seg.start_sec + chunk.startSec,
          end_sec: seg.end_sec + chunk.startSec,
        });
      }
      chunkTexts.push(result.text);
      // oxlint-disable-next-line no-await-in-loop
      await updateChunkTranscript(this.env.DB, chunk.id, result.text);
    }

    const transcriptKey = `${job.userId}/results/${job.jobId}/transcript.json`;
    await uploadJSON(this.env.BUCKET, transcriptKey, {
      text: chunkTexts.join("\n"),
      segments: allSegments,
    });

    await markAsTranscribed(this.env.DB, job.jobId, {
      transcriptKey,
      totalChunks: chunks.length,
    });
    return "continue";
  }

  private async runAnalyze(job: JobPayload): Promise<void> {
    const claimed = await claimJobForAnalyze(this.env.DB, job.jobId);
    if (!claimed) {
      const current = await findJobById(this.env.DB, job.jobId);
      // Another invocation is already running analyze on this job: nothing to
      // do. Treating `analyzing` as success here prevents duplicate enqueues
      // from flipping in-flight jobs to analyze_failed.
      if (current?.status === "analyzing") return;
      throw new Error(`could not claim job for analyze (status=${current?.status ?? "unknown"})`);
    }

    const current = await findJobById(this.env.DB, job.jobId);
    if (!current?.transcriptKey) {
      throw new Error("transcript_key not set; transcribe must complete before analyze");
    }

    // Clear any previous topics so the new analyze run replaces them instead
    // of being inserted alongside (relevant for regenerate-after-completed).
    await deleteTopicsByJob(this.env.DB, job.jobId);

    const transcriptObj = await this.env.BUCKET.get(current.transcriptKey);
    if (!transcriptObj) {
      throw new Error(`transcript not found in R2: ${current.transcriptKey}`);
    }
    const transcript = await transcriptObj.json<{ text: string; segments: Segment[] }>();

    const out = await analyzeWithGemini(transcript.segments, {
      apiKey: this.env.GEMINI_API_KEY,
      model: this.env.GEMINI_MODEL ?? "gemini-2.0-flash-lite",
    });

    await uploadJSON(this.env.BUCKET, `${job.userId}/results/${job.jobId}/topics.json`, out.topics);

    if (out.topics.length > 0) {
      await createTopics(
        this.env.DB,
        job.jobId,
        out.topics.map((t) => ({
          id: crypto.randomUUID(),
          topicIndex: t.index,
          title: t.title,
          summary: t.summary,
          detail: t.detail,
          startSec: t.start_sec,
          endSec: t.end_sec,
          transcript: t.transcript,
        })),
      );
    }

    const totalChunks = current.totalChunks ?? 0;
    await completeJob(this.env.DB, job.jobId, {
      summary: out.summary,
      totalChunks,
      completedChunks: totalChunks,
    });
  }

  private async handleTranscribeError(job: JobPayload, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await markAsTranscribeFailed(this.env.DB, job.jobId, message);

    const attempts = (job.transcribeAttempts ?? 0) + 1;
    if (attempts <= MAX_RETRIES) {
      await this.ctx.storage.put("job", { ...job, transcribeAttempts: attempts });
      await this.scheduleRetry(attempts * 30);
      return;
    }
    await this.ctx.storage.delete("job");
  }

  private async handleAnalyzeError(job: JobPayload, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await markAsAnalyzeFailed(this.env.DB, job.jobId, message);

    const attempts = (job.analyzeAttempts ?? 0) + 1;
    if (attempts <= MAX_RETRIES) {
      // Force the next schedule to start at the analyze phase so we don't
      // recharge Whisper.
      await this.ctx.storage.put("job", {
        ...job,
        analyzeAttempts: attempts,
        startPhase: "analyze",
      });
      await this.scheduleRetry(attempts * 30);
      return;
    }
    await this.ctx.storage.delete("job");
  }
}
