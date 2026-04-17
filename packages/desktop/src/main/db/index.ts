import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { LOCAL_USER_ID } from "./schema";

export { LOCAL_USER_ID };
export * from "./schema";

export type DesktopDb = ReturnType<typeof drizzle>;

export type DatabaseHandle = {
  db: DesktopDb;
  close: () => void;
};

// Reflects @koe/shared/db schema. Kept as an inline SQL block so the desktop
// bundle does not need to ship migration SQL files.
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
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
);

CREATE TABLE IF NOT EXISTS chunks (
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
);

CREATE TABLE IF NOT EXISTS topics (
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
);

CREATE TABLE IF NOT EXISTS sync_state (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  cloud_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  synced_at TEXT,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chunks_job ON chunks(job_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_topics_job ON topics(job_id, topic_index);
`;

const SEED_LOCAL_USER_SQL = `
INSERT OR IGNORE INTO users (id, google_id, email, name)
VALUES ('local', 'local', 'local@desktop', 'Local');
`;

export const createDatabase = (path: string): DatabaseHandle => {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(INIT_SQL);
  sqlite.exec(SEED_LOCAL_USER_SQL);

  const db = drizzle(sqlite);

  return {
    db,
    close: () => sqlite.close(),
  };
};

// Singleton accessor for the main process. Tests should prefer createDatabase(":memory:") directly.
let handle: DatabaseHandle | null = null;

export const initDesktopDatabase = (path: string): DatabaseHandle => {
  if (!handle) {
    handle = createDatabase(path);
  }
  return handle;
};

export const getDesktopDatabase = (): DatabaseHandle => {
  if (!handle) throw new Error("Desktop database has not been initialized");
  return handle;
};

export const closeDesktopDatabase = (): void => {
  handle?.close();
  handle = null;
};
