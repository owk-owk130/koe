export type Job = {
  id: string;
  userId: string;
  status: string;
  audioKey: string;
  audioDurationSec: number | null;
  totalChunks: number | null;
  completedChunks: number;
  error: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Topic = {
  id: string;
  jobId: string;
  topicIndex: number;
  title: string;
  summary: string | null;
  detail: string | null;
  startSec: number | null;
  endSec: number | null;
  transcript: string;
  transcriptKey: string | null;
  createdAt: string;
};

type JobRow = {
  id: string;
  user_id: string;
  status: string;
  audio_key: string;
  audio_duration_sec: number | null;
  total_chunks: number | null;
  completed_chunks: number;
  error: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

type TopicRow = {
  id: string;
  job_id: string;
  topic_index: number;
  title: string;
  summary: string | null;
  detail: string | null;
  start_sec: number | null;
  end_sec: number | null;
  transcript: string;
  transcript_key: string | null;
  created_at: string;
};

const toJob = (row: JobRow): Job => ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  audioKey: row.audio_key,
  audioDurationSec: row.audio_duration_sec,
  totalChunks: row.total_chunks,
  completedChunks: row.completed_chunks,
  error: row.error,
  summary: row.summary,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTopic = (row: TopicRow): Topic => ({
  id: row.id,
  jobId: row.job_id,
  topicIndex: row.topic_index,
  title: row.title,
  summary: row.summary,
  detail: row.detail,
  startSec: row.start_sec,
  endSec: row.end_sec,
  transcript: row.transcript,
  transcriptKey: row.transcript_key,
  createdAt: row.created_at,
});

export const createJob = async (
  db: D1Database,
  input: { id: string; userId: string; audioKey: string },
): Promise<Job> => {
  await db
    .prepare("INSERT INTO jobs (id, user_id, audio_key) VALUES (?, ?, ?)")
    .bind(input.id, input.userId, input.audioKey)
    .run();

  const row = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(input.id).first<JobRow>();
  return toJob(row!);
};

export const findJobById = async (db: D1Database, id: string): Promise<Job | null> => {
  const row = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobRow>();
  return row ? toJob(row) : null;
};

export const listJobsByUser = async (
  db: D1Database,
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<Job[]> => {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = opts.offset ?? 0;

  const { results } = await db
    .prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(userId, limit, offset)
    .all<JobRow>();

  return results.map(toJob);
};

export const updateJobStatus = async (
  db: D1Database,
  id: string,
  status: string,
  error?: string,
): Promise<void> => {
  await db
    .prepare("UPDATE jobs SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, error ?? null, id)
    .run();
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
  db: D1Database,
  jobId: string,
  topics: TopicInput[],
): Promise<void> => {
  const stmt = db.prepare(
    "INSERT INTO topics (id, job_id, topic_index, title, summary, detail, start_sec, end_sec, transcript, transcript_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  await db.batch(
    topics.map((t) =>
      stmt.bind(
        t.id,
        jobId,
        t.topicIndex,
        t.title,
        t.summary ?? null,
        t.detail ?? null,
        t.startSec ?? null,
        t.endSec ?? null,
        t.transcript,
        t.transcriptKey ?? null,
      ),
    ),
  );
};

export const createCompletedJob = async (
  db: D1Database,
  input: {
    id: string;
    userId: string;
    audioFilename: string;
    summary: string | null;
  },
): Promise<Job> => {
  const audioKey = `${input.userId}/audio/${input.id}/local-${input.audioFilename}`;
  await db
    .prepare(
      "INSERT INTO jobs (id, user_id, audio_key, status, summary) VALUES (?, ?, ?, 'completed', ?)",
    )
    .bind(input.id, input.userId, audioKey, input.summary)
    .run();

  const row = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(input.id).first<JobRow>();
  return toJob(row!);
};

export const findTopicsByJob = async (db: D1Database, jobId: string): Promise<Topic[]> => {
  const { results } = await db
    .prepare("SELECT * FROM topics WHERE job_id = ? ORDER BY topic_index ASC")
    .bind(jobId)
    .all<TopicRow>();

  return results.map(toTopic);
};
