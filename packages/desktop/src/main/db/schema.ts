import { chunks, jobs, topics, users } from "@koe/shared/db";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Shared tables re-exported so desktop repositories have a single import surface.
export { users, jobs, chunks, topics };
export type { User, Job, Chunk, Topic } from "@koe/shared/db";

// Desktop-local: tracks sync status of each job to the cloud API.
export const syncState = sqliteTable("sync_state", {
  jobId: text("job_id")
    .primaryKey()
    .references(() => jobs.id),
  cloudJobId: text("cloud_job_id"),
  status: text("status").notNull().default("pending"),
  syncedAt: text("synced_at"),
  lastError: text("last_error"),
  retryCount: integer("retry_count").notNull().default(0),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type SyncState = typeof syncState.$inferSelect;
export type NewSyncState = typeof syncState.$inferInsert;

// Sentinel user id used for locally-stored jobs prior to any cloud association.
export const LOCAL_USER_ID = "local";
