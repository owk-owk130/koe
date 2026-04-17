import { jobs, topics } from "@koe/shared/db";
import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "~/lib/db";

export type Job = typeof jobs.$inferSelect;
export type Topic = typeof topics.$inferSelect;

export const createJob = async (
  d1: D1Database,
  input: { id: string; userId: string; audioKey: string },
): Promise<Job> => {
  const db = getDb(d1);
  const [row] = await db
    .insert(jobs)
    .values({
      id: input.id,
      userId: input.userId,
      audioKey: input.audioKey,
    })
    .returning();
  return row;
};

export const findJobById = async (d1: D1Database, id: string): Promise<Job | null> => {
  const db = getDb(d1);
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row ?? null;
};

export const listJobsByUser = async (
  d1: D1Database,
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<Job[]> => {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = opts.offset ?? 0;
  const db = getDb(d1);

  return db
    .select()
    .from(jobs)
    .where(eq(jobs.userId, userId))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .offset(offset);
};

export const updateJobStatus = async (
  d1: D1Database,
  id: string,
  status: string,
  error?: string,
): Promise<void> => {
  const db = getDb(d1);
  await db
    .update(jobs)
    .set({
      status,
      error: error ?? null,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(jobs.id, id));
};

export type TopicInput = {
  id: string;
  topicIndex: number;
  title: string;
  summary?: string;
  detail?: string;
  startSec?: number;
  endSec?: number;
  transcript: string;
  transcriptKey?: string;
};

export const createTopics = async (
  d1: D1Database,
  jobId: string,
  topicsInput: TopicInput[],
): Promise<void> => {
  if (topicsInput.length === 0) return;
  const db = getDb(d1);
  await db.insert(topics).values(
    topicsInput.map((t) => ({
      id: t.id,
      jobId,
      topicIndex: t.topicIndex,
      title: t.title,
      summary: t.summary ?? null,
      detail: t.detail ?? null,
      startSec: t.startSec ?? null,
      endSec: t.endSec ?? null,
      transcript: t.transcript,
      transcriptKey: t.transcriptKey ?? null,
    })),
  );
};

export const createCompletedJob = async (
  d1: D1Database,
  input: {
    id: string;
    userId: string;
    audioFilename: string;
    summary: string | null;
  },
): Promise<Job> => {
  const db = getDb(d1);
  const audioKey = `${input.userId}/audio/${input.id}/local-${input.audioFilename}`;
  const [row] = await db
    .insert(jobs)
    .values({
      id: input.id,
      userId: input.userId,
      audioKey,
      status: "completed",
      summary: input.summary,
    })
    .returning();
  return row;
};

export const findTopicsByJob = async (d1: D1Database, jobId: string): Promise<Topic[]> => {
  const db = getDb(d1);
  return db.select().from(topics).where(eq(topics.jobId, jobId)).orderBy(asc(topics.topicIndex));
};
