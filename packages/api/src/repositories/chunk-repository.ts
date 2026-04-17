import { chunks } from "@koe/shared/db";
import { asc, eq } from "drizzle-orm";
import { getDb } from "~/lib/db";

export type Chunk = typeof chunks.$inferSelect;

export type ChunkInput = {
  id: string;
  chunkIndex: number;
  audioKey: string;
  startSec: number;
  endSec: number;
  transcript?: string;
};

export const createChunks = async (
  d1: D1Database,
  jobId: string,
  chunksInput: ChunkInput[],
): Promise<void> => {
  if (chunksInput.length === 0) return;
  const db = getDb(d1);
  await db.insert(chunks).values(
    chunksInput.map((c) => ({
      id: c.id,
      jobId,
      chunkIndex: c.chunkIndex,
      status: "completed",
      audioKey: c.audioKey,
      startSec: c.startSec,
      endSec: c.endSec,
      transcript: c.transcript ?? null,
    })),
  );
};

export const findChunksByJob = async (d1: D1Database, jobId: string): Promise<Chunk[]> => {
  const db = getDb(d1);
  return db.select().from(chunks).where(eq(chunks.jobId, jobId)).orderBy(asc(chunks.chunkIndex));
};
