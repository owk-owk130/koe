import { DurableObject } from "cloudflare:workers";
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

export class KoeProcessor extends DurableObject<Bindings> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/enqueue" && request.method === "POST") {
      const job = await request.json<JobPayload>();
      await this.ctx.storage.put("job", job);
      await this.ctx.storage.setAlarm(Date.now());
      return new Response("ok");
    }

    if (url.pathname === "/process" && request.method === "POST") {
      return this.forwardToContainer(request);
    }

    return new Response("not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const job = await this.ctx.storage.get<JobPayload>("job");
    if (!job) return;

    try {
      await this.processJob(job);
      await this.ctx.storage.delete("job");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retries = (job.retries ?? 0) + 1;

      if (retries <= MAX_RETRIES) {
        // Reset status to pending so the next retry can proceed
        await updateJobStatus(this.env.DB, job.jobId, "pending");
        await this.ctx.storage.put("job", { ...job, retries });
        await this.ctx.storage.setAlarm(Date.now() + retries * 30_000);
      } else {
        await updateJobStatus(this.env.DB, job.jobId, "failed", message);
        await this.ctx.storage.delete("job");
      }
    }
  }

  private async processJob(job: JobPayload): Promise<void> {
    const claimed = await claimJobForProcessing(this.env.DB, job.jobId);
    if (!claimed) return; // Already processing or completed

    // Download audio from R2 as stream
    const r2Object = await this.env.BUCKET.get(job.audioKey);
    if (!r2Object) {
      await updateJobStatus(this.env.DB, job.jobId, "failed", "audio not found in R2");
      return;
    }

    // Forward audio stream to container (no buffering)
    const response = await this.forwardToContainer(
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

    // Store results in R2
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

    // Store chunks in D1
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

    // Store topics in D1
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

  private async ensureContainerReady(): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("container not available");

    if (!container.running) {
      container.start({
        enableInternet: true,
        env: {
          WHISPER_BASE_URL: this.env.WHISPER_BASE_URL ?? "https://api.openai.com",
          WHISPER_API_KEY: this.env.WHISPER_API_KEY,
          WHISPER_MODEL: this.env.WHISPER_MODEL ?? "whisper-1",
          GEMINI_API_KEY: this.env.GEMINI_API_KEY,
          GEMINI_MODEL: this.env.GEMINI_MODEL ?? "gemini-2.0-flash-lite",
        },
      });
    }

    // `start()` is non-blocking — the Go HTTP server inside the container may
    // not be listening on :8080 yet. Poll /health until it responds or a
    // startup budget expires. Using the actual port the DO will forward to
    // ensures any proxy wiring is also in place before we stream the audio.
    const port = container.getTcpPort(8080);
    const deadline = Date.now() + 30_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- readiness polling is sequential by design
        const res = await port.fetch(new Request("http://container/health"));
        if (res.ok) return;
        lastError = new Error(`health status ${res.status}`);
      } catch (err) {
        lastError = err;
      }
      // oxlint-disable-next-line no-await-in-loop -- readiness polling is sequential by design
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`container not ready within 30s: ${message}`);
  }

  private async forwardToContainer(request: Request): Promise<Response> {
    await this.ensureContainerReady();
    return this.ctx.container!.getTcpPort(8080).fetch(request);
  }
}
