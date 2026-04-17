import type { DesktopDb } from "~/main/db";
import { getLocalJob } from "~/main/db/job-store";
import { listPendingSyncs, markSyncFailed, markSynced } from "~/main/db/sync-state";
import { buildSyncPayload } from "./build-payload";

export type SyncDeps = {
  fetch: typeof fetch;
  apiUrl: string;
  getToken: () => string | null;
};

export type SyncResult = {
  synced: number;
  failed: number;
  skipped: number;
};

type SyncApiResponse = { id: string };

export const syncPendingJobs = async (db: DesktopDb, deps: SyncDeps): Promise<SyncResult> => {
  const token = deps.getToken();
  if (!token) {
    const pending = listPendingSyncs(db).length;
    return { synced: 0, failed: 0, skipped: pending };
  }

  const pending = listPendingSyncs(db);
  let synced = 0;
  let failed = 0;

  for (const state of pending) {
    const detail = getLocalJob(db, state.jobId);
    if (!detail) {
      // Orphan sync_state — mark it failed so it stops showing up.
      markSyncFailed(db, state.jobId, "local job not found");
      failed += 1;
      continue;
    }

    const payload = buildSyncPayload({
      job: detail.job,
      topics: detail.topics,
      chunks: detail.chunks,
    });

    try {
      // oxlint-disable-next-line no-await-in-loop
      const res = await deps.fetch(`${deps.apiUrl}/api/v1/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        // oxlint-disable-next-line no-await-in-loop
        const text = await res.text().catch(() => "");
        markSyncFailed(db, state.jobId, `HTTP ${res.status}: ${text.slice(0, 200)}`);
        failed += 1;
        continue;
      }

      // oxlint-disable-next-line no-await-in-loop
      const body = (await res.json()) as SyncApiResponse;
      markSynced(db, state.jobId, body.id);
      synced += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markSyncFailed(db, state.jobId, message);
      failed += 1;
    }
  }

  return { synced, failed, skipped: 0 };
};
