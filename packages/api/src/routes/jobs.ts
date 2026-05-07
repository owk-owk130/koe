import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "~/lib/errors";
import { validate } from "~/lib/validation";
import { requireAuth } from "~/middleware/auth";
import { createChunks } from "~/repositories/chunk-repository";
import {
  createJob,
  deleteJob,
  findJobById,
  findTopicsByJob,
  listJobsByUser,
} from "~/repositories/job-repository";
import { enqueueJob } from "~/services/container-service";
import { deleteByPrefix, downloadJSON, uploadAudio } from "~/services/r2-storage";
import type { Env } from "~/types";

// Desktop side splits audio into ≤60s chunks before upload (see
// packages/desktop/src/renderer/lib/audio-chunker.ts), so the API receives
// the chunks directly and persists each one to R2. The Workers Containers
// path is gone — DO Whisper-calls these chunks in the transcribe phase.
const chunkMetaSchema = z.object({
  index: z.number().int().min(0),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
});

const chunksMetaArraySchema = z.array(chunkMetaSchema).min(1);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  offset: z.coerce.number().int().min(0).catch(0),
});

const jobs = new Hono<Env>()
  .use("/*", requireAuth())
  .post("/", async (c) => {
    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

    const form = await c.req.formData();
    const metaRaw = form.get("chunks_meta");
    if (typeof metaRaw !== "string") {
      throw new AppError(400, "BAD_REQUEST", "chunks_meta is required");
    }

    let chunksMeta: z.infer<typeof chunksMetaArraySchema>;
    try {
      const parsed = chunksMetaArraySchema.parse(JSON.parse(metaRaw));
      chunksMeta = parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(400, "BAD_REQUEST", `invalid chunks_meta: ${message}`);
    }

    const chunkFiles = chunksMeta.map((meta) => {
      const file = form.get(`chunk_${meta.index}`);
      if (!(file instanceof File)) {
        throw new AppError(400, "BAD_REQUEST", `missing chunk file for index ${meta.index}`);
      }
      return { meta, file };
    });

    const durationRaw = form.get("duration_sec");
    const audioDurationSec =
      typeof durationRaw === "string" && durationRaw.length > 0 ? Number(durationRaw) : null;

    const jobId = crypto.randomUUID();
    const audioKey = `${user.id}/audio/${jobId}/`;

    // Upload all chunks first so a partial failure leaves no D1 row pointing at
    // missing R2 objects.
    const chunkInputs = await Promise.all(
      chunkFiles.map(async ({ meta, file }) => {
        const chunkKey = `${user.id}/audio/${jobId}/chunks/${meta.index}.wav`;
        await uploadAudio(c.env.BUCKET, chunkKey, await file.arrayBuffer());
        return {
          id: crypto.randomUUID(),
          chunkIndex: meta.index,
          audioKey: chunkKey,
          startSec: meta.startSec,
          endSec: meta.endSec,
        };
      }),
    );

    const job = await createJob(c.env.DB, {
      id: jobId,
      userId: user.id,
      audioKey,
      audioDurationSec,
      totalChunks: chunkInputs.length,
    });
    await createChunks(c.env.DB, jobId, chunkInputs);

    try {
      if (c.env.PROCESSOR) {
        c.executionCtx.waitUntil(
          enqueueJob(c.env.PROCESSOR, {
            jobId: job.id,
            userId: user.id,
            audioKey,
          }),
        );
      }
    } catch {
      // executionCtx not available (e.g. in tests) — job stays pending
    }

    return c.json(
      {
        id: job.id,
        status: job.status,
        audio_key: job.audioKey,
        created_at: job.createdAt,
      },
      201,
    );
  })
  .get("/", validate("query", listQuerySchema), async (c) => {
    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const { limit, offset } = c.req.valid("query");

    const jobList = await listJobsByUser(c.env.DB, user.id, { limit, offset });

    return c.json({
      jobs: jobList.map((j) => ({
        id: j.id,
        status: j.status,
        audio_key: j.audioKey,
        audio_duration_sec: j.audioDurationSec,
        summary: j.summary,
        created_at: j.createdAt,
        updated_at: j.updatedAt,
      })),
    });
  })
  .get("/:id", async (c) => {
    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const job = await findJobById(c.env.DB, c.req.param("id"));

    if (!job || job.userId !== user.id) {
      throw new AppError(404, "NOT_FOUND", "Job not found");
    }

    return c.json({
      id: job.id,
      status: job.status,
      audio_key: job.audioKey,
      audio_duration_sec: job.audioDurationSec,
      total_chunks: job.totalChunks,
      completed_chunks: job.completedChunks,
      error: job.error,
      summary: job.summary,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    });
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const jobId = c.req.param("id");

    const job = await findJobById(c.env.DB, jobId);
    if (!job || job.userId !== user.id) {
      throw new AppError(404, "NOT_FOUND", "Job not found");
    }

    // R2 first: if D1 delete succeeds but R2 fails, orphans would remain silently.
    // Doing R2 first means a failure surfaces as a 500 and the client can retry
    // — the D1 row still points the user at the same job to delete again.
    await deleteByPrefix(c.env.BUCKET, `${user.id}/audio/${jobId}/`);
    await deleteByPrefix(c.env.BUCKET, `${user.id}/results/${jobId}/`);

    await deleteJob(c.env.DB, jobId, user.id);

    return c.body(null, 204);
  })
  .get("/:id/topics", async (c) => {
    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const job = await findJobById(c.env.DB, c.req.param("id"));

    if (!job || job.userId !== user.id) {
      throw new AppError(404, "NOT_FOUND", "Job not found");
    }

    const topics = await findTopicsByJob(c.env.DB, job.id);

    return c.json({
      topics: topics.map((t) => ({
        id: t.id,
        topic_index: t.topicIndex,
        title: t.title,
        summary: t.summary,
        detail: t.detail,
        start_sec: t.startSec,
        end_sec: t.endSec,
        transcript: t.transcript,
      })),
    });
  })
  // Returns the raw Whisper transcript persisted in R2 during the transcribe
  // phase. UI uses this for the "全文" section, which shows the unfiltered
  // transcription separately from Gemini's topic-level summaries.
  .get("/:id/transcript", async (c) => {
    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const job = await findJobById(c.env.DB, c.req.param("id"));

    if (!job || job.userId !== user.id) {
      throw new AppError(404, "NOT_FOUND", "Job not found");
    }

    if (!job.transcriptKey) {
      // Job hasn't reached the transcribed state yet (still pending /
      // transcribing, or it was a legacy single-phase job that never
      // recorded a transcript_key).
      throw new AppError(404, "NOT_FOUND", "Transcript not available for this job yet");
    }

    const data = await downloadJSON<{
      text: string;
      segments: { text: string; start_sec: number; end_sec: number }[];
    }>(c.env.BUCKET, job.transcriptKey);

    if (!data) {
      throw new AppError(404, "NOT_FOUND", "Transcript missing from storage");
    }

    return c.json({
      text: data.text,
      segments: data.segments,
    });
  })
  // Re-runs the analyze phase for a job whose transcript has already been
  // persisted. Useful when Gemini failed (analyze_failed) or when the user
  // wants a fresh summary without paying for Whisper again.
  .post("/:id/analyze", async (c) => {
    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const jobId = c.req.param("id");

    const job = await findJobById(c.env.DB, jobId);
    if (!job || job.userId !== user.id) {
      throw new AppError(404, "NOT_FOUND", "Job not found");
    }

    if (
      job.status !== "transcribed" &&
      job.status !== "analyze_failed" &&
      job.status !== "completed"
    ) {
      throw new AppError(
        409,
        "INVALID_STATE",
        `Cannot analyze a job in state "${job.status}". This endpoint only accepts jobs in "transcribed", "analyze_failed", or "completed" state.`,
      );
    }

    try {
      if (c.env.PROCESSOR) {
        c.executionCtx.waitUntil(
          enqueueJob(c.env.PROCESSOR, {
            jobId: job.id,
            userId: user.id,
            audioKey: job.audioKey,
            startPhase: "analyze",
          }),
        );
      }
    } catch {
      // executionCtx not available (e.g. in tests) — caller can poll status anyway.
    }

    return c.json({ id: job.id, status: job.status }, 202);
  });

export default jobs;
