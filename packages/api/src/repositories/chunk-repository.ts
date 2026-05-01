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

// D1 caps bound parameters at 100 per query (see
// https://developers.cloudflare.com/d1/platform/limits/). Each row in the
// chunks insert binds 8 columns, so we cap a single-statement insert at 12
// rows (12 * 8 = 96) and let the caller pass arbitrary lengths.
const CHUNKS_INSERT_BATCH_SIZE = 12;

export const createChunks = async (
  d1: D1Database,
  jobId: string,
  chunksInput: ChunkInput[],
): Promise<void> => {
  if (chunksInput.length === 0) return;
  const db = getDb(d1);

  const batches: ChunkInput[][] = [];
  for (let i = 0; i < chunksInput.length; i += CHUNKS_INSERT_BATCH_SIZE) {
    batches.push(chunksInput.slice(i, i + CHUNKS_INSERT_BATCH_SIZE));
  }

  await Promise.all(
    batches.map((batch) =>
      db.insert(chunks).values(
        batch.map((c) => ({
          id: c.id,
          jobId,
          chunkIndex: c.chunkIndex,
          status: "completed",
          audioKey: c.audioKey,
          startSec: c.startSec,
          endSec: c.endSec,
          transcript: c.transcript ?? null,
        })),
      ),
    ),
  );
};

export const findChunksByJob = async (d1: D1Database, jobId: string): Promise<Chunk[]> => {
  const db = getDb(d1);
  return db.select().from(chunks).where(eq(chunks.jobId, jobId)).orderBy(asc(chunks.chunkIndex));
};
