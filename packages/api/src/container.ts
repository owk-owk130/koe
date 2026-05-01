import { Container } from "@cloudflare/containers";
import type { DurableObject } from "cloudflare:workers";
import { createChunks } from "./repositories/chunk-repository";
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
import { uploadJSON } from "./services/r2-storage";
import type { Bindings } from "./types";

// JobPayload travels through DO storage between schedule fires. The phase
// fields keep retry state isolated so a Gemini failure cannot recharge Whisper.
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

type TranscribeOutput = {
  transcript: { text: string; segments: Segment[] };
  chunks: { index: number; start_sec: number; end_sec: number; text: string }[];
};

type AnalyzeOutput = {
  summary: string;
  topics: {
    index: number;
    title: string;
    summary: string;
    detail: string;
    start_sec: number;
    end_sec: number;
    transcript: string;
  }[];
};

const MAX_RETRIES = 3;

// Wraps the Go audio-processing server (packages/worker). The Container base
// class handles start/stop, port readiness, and idle sleep — we only implement
// the job orchestration (claim → transcribe → persist → analyze → complete).
export class KoeProcessor extends Container<Bindings> {
  defaultPort = 8080;
  sleepAfter = "5m"; // stop the container after 5 minutes of inactivity

  constructor(ctx: DurableObject["ctx"], env: Bindings) {
    super(ctx, env);
    this.envVars = {
      WHISPER_BASE_URL: env.WHISPER_BASE_URL ?? "https://api.openai.com",
      WHISPER_API_KEY: env.WHISPER_API_KEY,
      WHISPER_MODEL: env.WHISPER_MODEL ?? "whisper-1",
      GEMINI_API_KEY: env.GEMINI_API_KEY,
      GEMINI_MODEL: env.GEMINI_MODEL ?? "gemini-2.0-flash-lite",
    };
  }

  // The Container base class uses HTTP inflight counters to decide when the
  // container is idle, but a single long-running audio-processing request can
  // outlive that tracking and trigger sleepAfter while the pipeline is still
  // working. As long as we still hold a job in storage, keep the container
  // alive; otherwise fall back to the default stop behaviour.
  override async onActivityExpired(): Promise<void> {
    const job = await this.ctx.storage.get("job");
    if (job) {
      this.renewActivityTimeout();
      return;
    }
    await this.stop();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/enqueue" && request.method === "POST") {
      const job = await request.json<JobPayload>();
      await this.ctx.storage.put("job", job);
      // Use `schedule()` instead of setAlarm — the Container base class uses
      // its own alarm for activity timeout / sleep management, so we must not
      // override `alarm()` directly.
      await this.schedule(0, "runJob");
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  async runJob(): Promise<void> {
    const job = await this.ctx.storage.get<JobPayload>("job");
    if (!job) return;

    // Transcribe phase. Skipped when the job is being re-analyzed.
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

    // Analyze phase.
    try {
      await this.runAnalyze(job);
    } catch (err) {
      await this.handleAnalyzeError(job, err);
      return;
    }

    await this.ctx.storage.delete("job");
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

    const r2Object = await this.env.BUCKET.get(job.audioKey);
    if (!r2Object) {
      throw new Error("audio not found in R2");
    }

    const response = await this.containerFetch(
      new Request("http://container/transcribe", {
        method: "POST",
        body: r2Object.body,
        headers: {
          "Content-Type": r2Object.httpMetadata?.contentType ?? "audio/mpeg",
        },
      }),
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`container /transcribe error (${response.status}): ${text}`);
    }

    const out = await response.json<TranscribeOutput>();
    const transcriptKey = `${job.userId}/results/${job.jobId}/transcript.json`;
    await uploadJSON(this.env.BUCKET, transcriptKey, out.transcript);

    if (out.chunks.length > 0) {
      await createChunks(
        this.env.DB,
        job.jobId,
        out.chunks.map((c) => ({
          id: crypto.randomUUID(),
          chunkIndex: c.index,
          audioKey: `${job.userId}/audio/${job.jobId}/chunks/${c.index}.mp3`,
          startSec: c.start_sec,
          endSec: c.end_sec,
          transcript: c.text,
        })),
      );
    }

    await markAsTranscribed(this.env.DB, job.jobId, {
      transcriptKey,
      totalChunks: out.chunks.length,
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

    const response = await this.containerFetch(
      new Request("http://container/analyze", {
        method: "POST",
        body: JSON.stringify({ segments: transcript.segments }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`container /analyze error (${response.status}): ${text}`);
    }

    const out = await response.json<AnalyzeOutput>();

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
      await this.schedule(attempts * 30, "runJob");
      return;
    }
    // Retries exhausted. Status is already transcribe_failed; drop the job.
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
      await this.schedule(attempts * 30, "runJob");
      return;
    }
    await this.ctx.storage.delete("job");
  }
}
