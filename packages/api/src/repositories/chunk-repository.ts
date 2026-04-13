export type Chunk = {
  id: string;
  jobId: string;
  chunkIndex: number;
  status: string;
  audioKey: string;
  startSec: number;
  endSec: number;
  transcript: string | null;
  transcriptKey: string | null;
  error: string | null;
  createdAt: string;
};

type ChunkRow = {
  id: string;
  job_id: string;
  chunk_index: number;
  status: string;
  audio_key: string;
  start_sec: number;
  end_sec: number;
  transcript: string | null;
  transcript_key: string | null;
  error: string | null;
  created_at: string;
};

const toChunk = (row: ChunkRow): Chunk => ({
  id: row.id,
  jobId: row.job_id,
  chunkIndex: row.chunk_index,
  status: row.status,
  audioKey: row.audio_key,
  startSec: row.start_sec,
  endSec: row.end_sec,
  transcript: row.transcript,
  transcriptKey: row.transcript_key,
  error: row.error,
  createdAt: row.created_at,
});

export type ChunkInput = {
  id: string;
  chunkIndex: number;
  audioKey: string;
  startSec: number;
  endSec: number;
  transcript?: string;
};

export const createChunks = async (
  db: D1Database,
  jobId: string,
  chunks: ChunkInput[],
): Promise<void> => {
  const stmt = db.prepare(
    "INSERT INTO chunks (id, job_id, chunk_index, status, audio_key, start_sec, end_sec, transcript) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)",
  );

  await db.batch(
    chunks.map((c) =>
      stmt.bind(c.id, jobId, c.chunkIndex, c.audioKey, c.startSec, c.endSec, c.transcript ?? null),
    ),
  );
};

export const findChunksByJob = async (db: D1Database, jobId: string): Promise<Chunk[]> => {
  const { results } = await db
    .prepare("SELECT * FROM chunks WHERE job_id = ? ORDER BY chunk_index ASC")
    .bind(jobId)
    .all<ChunkRow>();

  return results.map(toChunk);
};
