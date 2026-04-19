import { jobs, topics } from "@koe/shared/db";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
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

// Atomic state transition: pending → processing.
// Used by the background processor to guarantee a single worker processes a job.
export const claimJobForProcessing = async (d1: D1Database, id: string): Promise<boolean> => {
  const db = getDb(d1);
  const rows = await db
    .update(jobs)
    .set({ status: "processing", updatedAt: sql`(datetime('now'))` })
    .where(and(eq(jobs.id, id), eq(jobs.status, "pending")))
    .returning({ id: jobs.id });
  return rows.length > 0;
};

export const completeJob = async (
  d1: D1Database,
  id: string,
  input: { summary: string; totalChunks: number; completedChunks: number },
): Promise<void> => {
  const db = getDb(d1);
  await db
    .update(jobs)
    .set({
      status: "completed",
      summary: input.summary,
      totalChunks: input.totalChunks,
      completedChunks: input.completedChunks,
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

// SQLite's LIKE does not honor escape sequences unless an ESCAPE clause is attached,
// so callers must use `likeEscape` alongside `ESCAPE '\\'` in the SQL fragment.
const likeEscape = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export const searchTopicsByUser = async (
  d1: D1Database,
  userId: string,
  opts: { query: string; limit?: number },
): Promise<Topic[]> => {
  const limit = Math.min(opts.limit ?? 20, 50);
  const pattern = `%${likeEscape(opts.query)}%`;
  const db = getDb(d1);

  const rows = await db
    .select({
      id: topics.id,
      jobId: topics.jobId,
      topicIndex: topics.topicIndex,
      title: topics.title,
      summary: topics.summary,
      detail: topics.detail,
      startSec: topics.startSec,
      endSec: topics.endSec,
      transcript: topics.transcript,
      transcriptKey: topics.transcriptKey,
      createdAt: topics.createdAt,
    })
    .from(topics)
    .innerJoin(jobs, eq(jobs.id, topics.jobId))
    .where(
      and(
        eq(jobs.userId, userId),
        or(
          sql`${topics.title} LIKE ${pattern} ESCAPE '\\'`,
          sql`${topics.summary} LIKE ${pattern} ESCAPE '\\'`,
        ),
      ),
    )
    .orderBy(desc(topics.createdAt))
    .limit(limit);

  return rows;
};
