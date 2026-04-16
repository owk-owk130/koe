import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "~/lib/errors";
import { validate } from "~/lib/validation";
import { requireAuth } from "~/middleware/auth";
import { createCompletedJob, createTopics } from "~/repositories/job-repository";
import { uploadJSON } from "~/services/r2-storage";
import type { Env } from "~/types";

const syncSchema = z.object({
  audio_filename: z.string().min(1),
  transcript: z.object({
    text: z.string().min(1),
    segments: z.array(
      z.object({
        text: z.string(),
        start_sec: z.number(),
        end_sec: z.number(),
      }),
    ),
  }),
  summary: z.string().optional(),
  topics: z
    .array(
      z.object({
        index: z.number(),
        title: z.string(),
        summary: z.string(),
        detail: z.string().optional(),
        start_sec: z.number(),
        end_sec: z.number(),
        transcript: z.string(),
      }),
    )
    .optional(),
  chunks: z
    .array(
      z.object({
        index: z.number(),
        start_sec: z.number(),
        end_sec: z.number(),
        text: z.string(),
      }),
    )
    .optional(),
});

const sync = new Hono<Env>()
  .use("/*", requireAuth())
  .post("/", validate("json", syncSchema), async (c) => {
    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

    const body = c.req.valid("json");
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
