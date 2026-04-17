import { and, eq, lt, sql } from "drizzle-orm";
import type { DesktopDb } from "./index";
import { syncState, type SyncState } from "./schema";

export const MAX_SYNC_RETRIES = 3;

export const listPendingSyncs = (db: DesktopDb): SyncState[] => {
  return db
    .select()
    .from(syncState)
    .where(and(eq(syncState.status, "pending"), lt(syncState.retryCount, MAX_SYNC_RETRIES)))
    .all();
};

export const getSyncState = (db: DesktopDb, jobId: string): SyncState | null => {
  const [row] = db.select().from(syncState).where(eq(syncState.jobId, jobId)).limit(1).all();
  return row ?? null;
};

export const markSynced = (db: DesktopDb, jobId: string, cloudJobId: string): void => {
  const now = new Date().toISOString();
  db.update(syncState)
    .set({
      status: "synced",
      cloudJobId,
      syncedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(syncState.jobId, jobId))
    .run();
};

// Increments retryCount. Transitions to 'failed' once MAX_SYNC_RETRIES is reached so the
// orchestrator stops re-picking the row.
export const markSyncFailed = (db: DesktopDb, jobId: string, error: string): void => {
  const now = new Date().toISOString();
  db.update(syncState)
    .set({
      retryCount: sql`${syncState.retryCount} + 1`,
      lastError: error,
      status: sql`CASE WHEN ${syncState.retryCount} + 1 >= ${MAX_SYNC_RETRIES} THEN 'failed' ELSE 'pending' END`,
      updatedAt: now,
    })
    .where(eq(syncState.jobId, jobId))
    .run();
};
