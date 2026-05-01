import { chunks, jobs, type JobStatus, topics } from "@koe/shared/db";
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
  status: JobStatus,
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

// Atomic transition for the transcribe phase: pending or transcribe_failed → transcribing.
// Accepting transcribe_failed lets the orchestrator retry without going through pending.
// Clears any stale error so the new attempt starts clean.
export const claimJobForTranscribe = async (d1: D1Database, id: string): Promise<boolean> => {
  const db = getDb(d1);
  const rows = await db
    .update(jobs)
    .set({ status: "transcribing", error: null, updatedAt: sql`(datetime('now'))` })
    .where(
      and(eq(jobs.id, id), or(eq(jobs.status, "pending"), eq(jobs.status, "transcribe_failed"))),
    )
    .returning({ id: jobs.id });
  return rows.length > 0;
};

// Records the persisted transcript artifact and moves the job into the analyze-eligible
// state. completedChunks is set to totalChunks because all chunks transcribed successfully
// by the time we reach this state.
export const markAsTranscribed = async (
  d1: D1Database,
  id: string,
  input: { transcriptKey: string; totalChunks: number },
): Promise<void> => {
  const db = getDb(d1);
  await db
    .update(jobs)
    .set({
      status: "transcribed",
      transcriptKey: input.transcriptKey,
      totalChunks: input.totalChunks,
      completedChunks: input.totalChunks,
      error: null,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(jobs.id, id));
};

// Atomic transition for the analyze phase: any analyze-eligible status → analyzing.
// `transcribed` is the normal first analyze; `analyze_failed` is the automatic
// retry path; `completed` covers user-initiated regeneration after a successful
// run (e.g. wanting fresh topics under a new prompt).
export const claimJobForAnalyze = async (d1: D1Database, id: string): Promise<boolean> => {
  const db = getDb(d1);
  const rows = await db
    .update(jobs)
    .set({ status: "analyzing", error: null, updatedAt: sql`(datetime('now'))` })
    .where(
      and(
        eq(jobs.id, id),
        or(
          eq(jobs.status, "transcribed"),
          eq(jobs.status, "analyze_failed"),
          eq(jobs.status, "completed"),
        ),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length > 0;
};

export const markAsTranscribeFailed = async (
  d1: D1Database,
  id: string,
  error: string,
): Promise<void> => {
  const db = getDb(d1);
  await db
    .update(jobs)
    .set({ status: "transcribe_failed", error, updatedAt: sql`(datetime('now'))` })
    .where(eq(jobs.id, id));
};

export const markAsAnalyzeFailed = async (
  d1: D1Database,
  id: string,
  error: string,
): Promise<void> => {
  const db = getDb(d1);
  await db
    .update(jobs)
    .set({ status: "analyze_failed", error, updatedAt: sql`(datetime('now'))` })
    .where(eq(jobs.id, id));
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

// D1 caps bound parameters at 100 per query (see
// https://developers.cloudflare.com/d1/platform/limits/). Each row in the
// topics insert binds 10 columns, so we cap a single-statement insert at 9
// rows (9 * 10 = 90) and let the caller pass arbitrary lengths.
const TOPICS_INSERT_BATCH_SIZE = 9;

export const createTopics = async (
  d1: D1Database,
  jobId: string,
  topicsInput: TopicInput[],
): Promise<void> => {
  if (topicsInput.length === 0) return;
  const db = getDb(d1);

  const batches: TopicInput[][] = [];
  for (let i = 0; i < topicsInput.length; i += TOPICS_INSERT_BATCH_SIZE) {
    batches.push(topicsInput.slice(i, i + TOPICS_INSERT_BATCH_SIZE));
  }

  await Promise.all(
    batches.map((batch) =>
      db.insert(topics).values(
        batch.map((t) => ({
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
      ),
    ),
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

// Removes every topic row for a job. Used before re-analyze runs so the new
// Gemini output replaces the previous topics instead of being inserted on top.
export const deleteTopicsByJob = async (d1: D1Database, jobId: string): Promise<void> => {
  const db = getDb(d1);
  await db.delete(topics).where(eq(topics.jobId, jobId));
};

// Deletes the job and its dependent rows (topics, chunks) only when the caller owns it.
// Returns true if the job existed and belonged to userId; false otherwise.
export const deleteJob = async (
  d1: D1Database,
  jobId: string,
  userId: string,
): Promise<boolean> => {
  const db = getDb(d1);
  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  if (!existing) return false;

  await db.delete(topics).where(eq(topics.jobId, jobId));
  await db.delete(chunks).where(eq(chunks.jobId, jobId));
  await db.delete(jobs).where(eq(jobs.id, jobId));
  return true;
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
