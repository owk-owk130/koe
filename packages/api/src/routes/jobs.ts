import { Hono } from "hono";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import {
  createJob,
  findJobById,
  findTopicsByJob,
  listJobsByUser,
} from "../repositories/job-repository";
import { uploadAudio } from "../services/r2-storage";

const jobs = new Hono<Env>();

jobs.use("/*", requireAuth());

jobs.post("/", async (c) => {
  const body = await c.req.parseBody();
  const file = body.audio;
  if (!(file instanceof File)) {
    throw new AppError(400, "BAD_REQUEST", "audio file is required");
  }

  const user = c.get("user")!;
  const jobId = crypto.randomUUID();
  const ext = file.name.split(".").pop() ?? "mp3";
  const audioKey = `${user.id}/audio/${jobId}/original.${ext}`;

  await uploadAudio(c.env.BUCKET, audioKey, await file.arrayBuffer());

  const job = await createJob(c.env.DB, {
    id: jobId,
    userId: user.id,
    audioKey,
  });

  return c.json(
    {
      id: job.id,
      status: job.status,
      audio_key: job.audioKey,
      created_at: job.createdAt,
    },
    201,
  );
});

jobs.get("/", async (c) => {
  const user = c.get("user")!;
  const rawLimit = parseInt(c.req.query("limit") ?? "20", 10);
  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Math.min(Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const jobList = await listJobsByUser(c.env.DB, user.id, { limit, offset });

  return c.json({
    jobs: jobList.map((j) => ({
      id: j.id,
      status: j.status,
      audio_key: j.audioKey,
      created_at: j.createdAt,
      updated_at: j.updatedAt,
    })),
  });
});

jobs.get("/:id", async (c) => {
  const user = c.get("user")!;
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
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  });
});

jobs.get("/:id/topics", async (c) => {
  const user = c.get("user")!;
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
      start_sec: t.startSec,
      end_sec: t.endSec,
      transcript: t.transcript,
    })),
  });
});

export default jobs;
