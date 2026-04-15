import { applyD1Migrations, env } from "cloudflare:test";

const migrations = [
  {
    name: "0001_init",
    queries: [
      `CREATE TABLE users (
        id TEXT PRIMARY KEY,
        google_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending',
        audio_key TEXT NOT NULL,
        audio_duration_sec REAL,
        total_chunks INTEGER,
        completed_chunks INTEGER DEFAULT 0,
        error TEXT,
        summary TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        chunk_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        audio_key TEXT NOT NULL,
        start_sec REAL NOT NULL,
        end_sec REAL NOT NULL,
        transcript TEXT,
        transcript_key TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE topics (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        topic_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        detail TEXT,
        start_sec REAL,
        end_sec REAL,
        transcript TEXT NOT NULL,
        transcript_key TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX idx_jobs_user ON jobs(user_id, created_at)`,
      `CREATE INDEX idx_chunks_job ON chunks(job_id, chunk_index)`,
      `CREATE INDEX idx_topics_job ON topics(job_id, topic_index)`,
    ],
  },
];

export async function setupD1() {
  await applyD1Migrations(env.DB, migrations);
}
