import { Hono } from "hono";
import type { Env } from "~/types";
import { AppError } from "~/lib/errors";
import { requireAuth } from "~/middleware/auth";
import { createCompletedJob, createTopics } from "~/repositories/job-repository";
import { uploadJSON } from "~/services/r2-storage";

type SyncTopic = {
  index: number;
  title: string;
  summary: string;
  detail?: string;
  start_sec: number;
  end_sec: number;
  transcript: string;
};

type SyncBody = {
  audio_filename: string;
  transcript: {
    text: string;
    segments: Array<{ text: string; start_sec: number; end_sec: number }>;
  };
  summary?: string;
  topics?: SyncTopic[];
  chunks?: Array<{ index: number; start_sec: number; end_sec: number; text: string }>;
};

const sync = new Hono<Env>().use("/*", requireAuth()).post("/", async (c) => {
  const user = c.get("user");
  if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

  const body = await c.req.json<SyncBody>();

  if (!body.audio_filename || !body.transcript?.text) {
    throw new AppError(400, "BAD_REQUEST", "audio_filename and transcript.text are required");
  }

  const jobId = crypto.randomUUID();
  const topics = body.topics ?? [];

  // 1. Create completed job in D1
  const job = await createCompletedJob(c.env.DB, {
    id: jobId,
    userId: user.id,
    audioFilename: body.audio_filename,
    summary: body.summary || null,
  });

  // 2. Store transcript and topics in R2
  const transcriptKey = `${user.id}/results/${jobId}/transcript.json`;
  const topicsKey = `${user.id}/results/${jobId}/topics.json`;

  await uploadJSON(c.env.BUCKET, transcriptKey, body.transcript);
  await uploadJSON(c.env.BUCKET, topicsKey, topics);

  // 3. Create topics in D1
  if (topics.length > 0) {
    await createTopics(
      c.env.DB,
      jobId,
      topics.map((t) => ({
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

  return c.json(
    {
      id: job.id,
      status: job.status,
      created_at: job.createdAt,
    },
    201,
  );
});

export default sync;
