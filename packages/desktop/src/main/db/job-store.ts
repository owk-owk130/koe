import { asc, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DesktopDb } from "./index";
import {
  chunks,
  jobs,
  LOCAL_USER_ID,
  syncState,
  topics,
  type Chunk,
  type Job,
  type Topic,
} from "./schema";

export type SaveLocalJobInput = {
  id: string;
  audioFilename: string;
  audioDurationSec?: number;
  summary: string;
  transcript: {
    text: string;
    segments: Array<{ text: string; start_sec: number; end_sec: number }>;
  };
  topics: Array<{
    index: number;
    title: string;
    summary: string;
    detail: string;
    start_sec: number;
    end_sec: number;
    transcript: string;
  }>;
  chunks: Array<{ index: number; start_sec: number; end_sec: number; text: string }>;
};

export type LocalJobDetail = {
  job: Job;
  topics: Topic[];
  chunks: Chunk[];
};

const audioKeyFor = (jobId: string, filename: string) =>
  `${LOCAL_USER_ID}/audio/${jobId}/${filename}`;

export const saveLocalJob = (db: DesktopDb, input: SaveLocalJobInput): void => {
  const sqlite = db.$client;
  const audioKey = audioKeyFor(input.id, input.audioFilename);
  const totalChunks = input.chunks.length;
  // Use ms-precision timestamps so ordering is stable for rapid successive inserts
  // (SQLite's datetime('now') only has second precision).
  const now = new Date().toISOString();

  sqlite.transaction(() => {
    db.insert(jobs)
      .values({
        id: input.id,
        userId: LOCAL_USER_ID,
        status: "completed",
        audioKey,
        audioDurationSec: input.audioDurationSec ?? null,
        totalChunks,
        completedChunks: totalChunks,
        summary: input.summary,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    if (input.chunks.length > 0) {
      db.insert(chunks)
        .values(
          input.chunks.map((c) => ({
            id: randomUUID(),
            jobId: input.id,
            chunkIndex: c.index,
            status: "completed",
            audioKey: `${LOCAL_USER_ID}/audio/${input.id}/chunks/${c.index}.mp3`,
            startSec: c.start_sec,
            endSec: c.end_sec,
            transcript: c.text,
          })),
        )
        .run();
    }

    if (input.topics.length > 0) {
      db.insert(topics)
        .values(
          input.topics.map((t) => ({
            id: randomUUID(),
            jobId: input.id,
            topicIndex: t.index,
            title: t.title,
            summary: t.summary,
            detail: t.detail,
            startSec: t.start_sec,
            endSec: t.end_sec,
            transcript: t.transcript,
          })),
        )
        .run();
    }

    db.insert(syncState)
      .values({
        jobId: input.id,
        status: "pending",
      })
      .run();
  })();
};

export const listLocalJobs = (db: DesktopDb): Job[] => {
  // rowid falls back to insertion order when createdAt collides (sub-second rapid inserts).
  return db
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt), sql`rowid DESC`)
    .all();
};

export const getLocalJob = (db: DesktopDb, id: string): LocalJobDetail | null => {
  const [job] = db.select().from(jobs).where(eq(jobs.id, id)).limit(1).all();
  if (!job) return null;

  const jobTopics = db
    .select()
    .from(topics)
    .where(eq(topics.jobId, id))
    .orderBy(asc(topics.topicIndex))
    .all();

  const jobChunks = db
    .select()
    .from(chunks)
    .where(eq(chunks.jobId, id))
    .orderBy(asc(chunks.chunkIndex))
    .all();

  return { job, topics: jobTopics, chunks: jobChunks };
};
