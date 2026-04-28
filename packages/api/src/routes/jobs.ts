import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "~/lib/errors";
import { validate } from "~/lib/validation";
import { requireAuth } from "~/middleware/auth";
import {
  createJob,
  deleteJob,
  findJobById,
  findTopicsByJob,
  listJobsByUser,
} from "~/repositories/job-repository";
import { enqueueJob } from "~/services/container-service";
import { deleteByPrefix, uploadAudio } from "~/services/r2-storage";
import type { Env } from "~/types";

const audioFormSchema = z.object({
  audio: z.instanceof(File),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  offset: z.coerce.number().int().min(0).catch(0),
});

const jobs = new Hono<Env>()
  .use("/*", requireAuth())
  .post("/", validate("form", audioFormSchema), async (c) => {
    const { audio: file } = c.req.valid("form");

    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const jobId = crypto.randomUUID();
    const ext = file.name.split(".").pop() ?? "mp3";
    const audioKey = `${user.id}/audio/${jobId}/original.${ext}`;

    await uploadAudio(c.env.BUCKET, audioKey, await file.arrayBuffer());

    const job = await createJob(c.env.DB, {
      id: jobId,
      userId: user.id,
      audioKey,
    });

    // Enqueue background processing via DurableObject alarm
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

    if (job.status !== "transcribed" && job.status !== "analyze_failed") {
      throw new AppError(
        409,
        "INVALID_STATE",
        `Cannot analyze a job in state "${job.status}". Wait until transcription completes.`,
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
