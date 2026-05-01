import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const defaultNow = sql`(datetime('now'))`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: text("created_at").notNull().default(defaultNow),
});

// Two-phase pipeline status flow:
//   pending → transcribing → transcribed → analyzing → completed
//                   ↓                ↓
//          transcribe_failed   analyze_failed
// 'failed' is retained for legacy single-phase rows; the orchestrator never
// produces it for new jobs.
export type JobStatus =
  | "pending"
  | "transcribing"
  | "transcribed"
  | "analyzing"
  | "completed"
  | "transcribe_failed"
  | "analyze_failed"
  | "failed";

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending").$type<JobStatus>(),
    audioKey: text("audio_key").notNull(),
    audioDurationSec: real("audio_duration_sec"),
    totalChunks: integer("total_chunks"),
    completedChunks: integer("completed_chunks").default(0),
    error: text("error"),
    summary: text("summary"),
    transcriptKey: text("transcript_key"),
    createdAt: text("created_at").notNull().default(defaultNow),
    updatedAt: text("updated_at").notNull().default(defaultNow),
  },
  (table) => [index("idx_jobs_user").on(table.userId, table.createdAt)],
);

export const chunks = sqliteTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    chunkIndex: integer("chunk_index").notNull(),
    status: text("status").notNull().default("pending"),
    audioKey: text("audio_key").notNull(),
    startSec: real("start_sec").notNull(),
    endSec: real("end_sec").notNull(),
    transcript: text("transcript"),
    transcriptKey: text("transcript_key"),
    error: text("error"),
    createdAt: text("created_at").notNull().default(defaultNow),
  },
  (table) => [index("idx_chunks_job").on(table.jobId, table.chunkIndex)],
);

export const topics = sqliteTable(
  "topics",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    topicIndex: integer("topic_index").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    detail: text("detail"),
    startSec: real("start_sec"),
    endSec: real("end_sec"),
    transcript: text("transcript").notNull(),
    transcriptKey: text("transcript_key"),
    createdAt: text("created_at").notNull().default(defaultNow),
  },
  (table) => [index("idx_topics_job").on(table.jobId, table.topicIndex)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
