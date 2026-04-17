import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "./index";
import { saveLocalJob } from "./job-store";
import {
  getSyncState,
  listPendingSyncs,
  markSyncFailed,
  markSynced,
  MAX_SYNC_RETRIES,
} from "./sync-state";

const seedJob = (handle: DatabaseHandle, id: string) => {
  saveLocalJob(handle.db, {
    id,
    audioFilename: `${id}.mp3`,
    summary: "sum",
    transcript: { text: "t", segments: [] },
    topics: [],
    chunks: [{ index: 0, start_sec: 0, end_sec: 1, text: "hi" }],
  });
};

describe("sync-state", () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = createDatabase(":memory:");
  });

  it("lists jobs whose sync_state is pending", () => {
    seedJob(handle, "a");
    seedJob(handle, "b");

    const pending = listPendingSyncs(handle.db);
    expect(pending.map((r) => r.jobId).sort()).toEqual(["a", "b"]);
  });

  it("markSynced transitions a job to synced with cloud id", () => {
    seedJob(handle, "a");

    markSynced(handle.db, "a", "cloud-123");

    const state = getSyncState(handle.db, "a");
    expect(state?.status).toBe("synced");
    expect(state?.cloudJobId).toBe("cloud-123");
    expect(state?.syncedAt).not.toBeNull();
    expect(listPendingSyncs(handle.db)).toEqual([]);
  });

  it("markSyncFailed increments retry count and records error (below max)", () => {
    seedJob(handle, "a");

    markSyncFailed(handle.db, "a", "network error");

    const state = getSyncState(handle.db, "a");
    expect(state?.status).toBe("pending");
    expect(state?.retryCount).toBe(1);
    expect(state?.lastError).toBe("network error");
    expect(listPendingSyncs(handle.db).map((r) => r.jobId)).toEqual(["a"]);
  });

  it("markSyncFailed transitions to failed after MAX_SYNC_RETRIES", () => {
    seedJob(handle, "a");

    for (let i = 0; i < MAX_SYNC_RETRIES; i++) {
      markSyncFailed(handle.db, "a", `attempt ${i}`);
    }

    const state = getSyncState(handle.db, "a");
    expect(state?.status).toBe("failed");
    expect(state?.retryCount).toBe(MAX_SYNC_RETRIES);
    // failed jobs should not be re-picked for sync
    expect(listPendingSyncs(handle.db)).toEqual([]);
  });
});
