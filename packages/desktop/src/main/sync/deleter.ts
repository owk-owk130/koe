import type { DesktopDb } from "~/main/db";
import { deleteLocalJob } from "~/main/db/job-store";
import { getSyncState } from "~/main/db/sync-state";

export type DeleteJobDeps = {
  fetch: typeof fetch;
  apiUrl: string;
  getToken: () => string | null;
};

// Deletes a local job, and — when it has been synced to the cloud — asks the API
// to delete the remote copy first. The cloud delete is the gate: if it fails, the
// local row is preserved so the user can retry (matches "keep local on error").
export const deleteJobEverywhere = async (
  db: DesktopDb,
  jobId: string,
  deps: DeleteJobDeps,
): Promise<void> => {
  const state = getSyncState(db, jobId);
  const cloudJobId = state?.cloudJobId ?? null;
  const token = deps.getToken();

  if (cloudJobId && token) {
    const res = await deps.fetch(`${deps.apiUrl}/api/v1/jobs/${cloudJobId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    // 404 means the remote is already gone — treat as success so the local row
    // can be cleared and the user isn't trapped by server-side state drift.
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `クラウドの履歴削除に失敗しました (HTTP ${res.status}): ${text.slice(0, 200)}`,
      );
    }
  }

  const removed = deleteLocalJob(db, jobId);
  if (!removed) {
    throw new Error("履歴が見つかりませんでした");
  }
};
