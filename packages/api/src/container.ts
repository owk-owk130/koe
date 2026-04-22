import { Container } from "@cloudflare/containers";
import type { DurableObject } from "cloudflare:workers";
import { createChunks } from "./repositories/chunk-repository";
import {
  claimJobForProcessing,
  completeJob,
  createTopics,
  updateJobStatus,
} from "./repositories/job-repository";
import { uploadJSON } from "./services/r2-storage";
import type { Bindings } from "./types";

export type JobPayload = {
  jobId: string;
  userId: string;
  audioKey: string;
  retries?: number;
};

export type ProcessResult = {
  transcript: {
    text: string;
    segments: { text: string; start_sec: number; end_sec: number }[];
  };
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
  chunks: {
    index: number;
    start_sec: number;
    end_sec: number;
    text: string;
  }[];
};

const MAX_RETRIES = 3;

// Wraps the Go audio-processing server (packages/worker). The Container base
// class handles start/stop, port readiness, and idle sleep — we only implement
// the job orchestration (claim → forward → persist → complete).
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

    try {
      await this.processJob(job);
      await this.ctx.storage.delete("job");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retries = (job.retries ?? 0) + 1;

      if (retries <= MAX_RETRIES) {
        await updateJobStatus(this.env.DB, job.jobId, "pending");
        await this.ctx.storage.put("job", { ...job, retries });
        // exponential-ish backoff: 30s, 60s, 90s
        await this.schedule(retries * 30, "runJob");
      } else {
        await updateJobStatus(this.env.DB, job.jobId, "failed", message);
        await this.ctx.storage.delete("job");
      }
    }
  }

  private async processJob(job: JobPayload): Promise<void> {
    const claimed = await claimJobForProcessing(this.env.DB, job.jobId);
    if (!claimed) return; // Already processing or completed

    const r2Object = await this.env.BUCKET.get(job.audioKey);
    if (!r2Object) {
      await updateJobStatus(this.env.DB, job.jobId, "failed", "audio not found in R2");
      return;
    }

    const response = await this.containerFetch(
      new Request("http://container/process", {
        method: "POST",
        body: r2Object.body,
        headers: {
          "Content-Type": r2Object.httpMetadata?.contentType ?? "audio/mpeg",
        },
      }),
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`container error (${response.status}): ${text}`);
    }

    const result = await response.json<ProcessResult>();

    await uploadJSON(
      this.env.BUCKET,
      `${job.userId}/results/${job.jobId}/transcript.json`,
      result.transcript,
    );
    await uploadJSON(
      this.env.BUCKET,
      `${job.userId}/results/${job.jobId}/topics.json`,
      result.topics,
    );

    if (result.chunks.length > 0) {
      await createChunks(
        this.env.DB,
        job.jobId,
        result.chunks.map((c) => ({
          id: crypto.randomUUID(),
          chunkIndex: c.index,
          audioKey: `${job.userId}/audio/${job.jobId}/chunks/${c.index}.mp3`,
          startSec: c.start_sec,
          endSec: c.end_sec,
          transcript: c.text,
        })),
      );
    }

    if (result.topics.length > 0) {
      await createTopics(
        this.env.DB,
        job.jobId,
        result.topics.map((t) => ({
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

    await completeJob(this.env.DB, job.jobId, {
      summary: result.summary,
      totalChunks: result.chunks.length,
      completedChunks: result.chunks.length,
    });
  }
}
