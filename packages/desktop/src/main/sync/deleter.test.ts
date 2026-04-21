import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseHandle } from "~/main/db";
import { getLocalJob, saveLocalJob } from "~/main/db/job-store";
import { deleteJobEverywhere } from "./deleter";

const seedJob = (handle: DatabaseHandle, id: string) => {
  saveLocalJob(handle.db, {
    id,
    audioFilename: `${id}.mp3`,
    summary: "sum",
    transcript: { text: "t", segments: [] },
    topics: [],
    chunks: [{ index: 0, start_sec: 0, end_sec: 1, text: "hello" }],
  });
};

const markSynced = (handle: DatabaseHandle, jobId: string, cloudJobId: string) => {
  handle.db.$client
    .prepare("UPDATE sync_state SET status = 'synced', cloud_job_id = ? WHERE job_id = ?")
    .run(cloudJobId, jobId);
};

describe("deleteJobEverywhere", () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = createDatabase(":memory:");
  });

  it("deletes local immediately when the job was never synced", async () => {
    seedJob(handle, "local-only");
    const fetchMock = vi.fn();

    await deleteJobEverywhere(handle.db, "local-only", {
      fetch: fetchMock as unknown as typeof fetch,
      apiUrl: "http://example.test",
      getToken: () => "tok",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getLocalJob(handle.db, "local-only")).toBeNull();
  });

  it("deletes local when synced but the user is logged out (offline delete)", async () => {
    seedJob(handle, "synced");
    markSynced(handle, "synced", "cloud-1");
    const fetchMock = vi.fn();

    await deleteJobEverywhere(handle.db, "synced", {
      fetch: fetchMock as unknown as typeof fetch,
      apiUrl: "http://example.test",
      getToken: () => null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getLocalJob(handle.db, "synced")).toBeNull();
  });

  it("calls DELETE on the API with the cloud job id and then removes local", async () => {
    seedJob(handle, "synced-2");
    markSynced(handle, "synced-2", "cloud-2");

    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

    await deleteJobEverywhere(handle.db, "synced-2", {
      fetch: fetchMock as unknown as typeof fetch,
      apiUrl: "http://example.test",
      getToken: () => "tok",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.test/api/v1/jobs/cloud-2",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
    expect(getLocalJob(handle.db, "synced-2")).toBeNull();
  });

  it("treats a 404 from the API as success (remote already gone)", async () => {
    seedJob(handle, "stale");
    markSynced(handle, "stale", "cloud-stale");

    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));

    await deleteJobEverywhere(handle.db, "stale", {
      fetch: fetchMock as unknown as typeof fetch,
      apiUrl: "http://example.test",
      getToken: () => "tok",
    });

    expect(getLocalJob(handle.db, "stale")).toBeNull();
  });

  it("keeps the local row when the API returns 5xx", async () => {
    seedJob(handle, "fail");
    markSynced(handle, "fail", "cloud-fail");

    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));

    await expect(
      deleteJobEverywhere(handle.db, "fail", {
        fetch: fetchMock as unknown as typeof fetch,
        apiUrl: "http://example.test",
        getToken: () => "tok",
      }),
    ).rejects.toThrow(/500/);

    // Local row is preserved so the user can retry.
    expect(getLocalJob(handle.db, "fail")).not.toBeNull();
  });

  it("keeps the local row when fetch throws (network error)", async () => {
    seedJob(handle, "net");
    markSynced(handle, "net", "cloud-net");

    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      deleteJobEverywhere(handle.db, "net", {
        fetch: fetchMock as unknown as typeof fetch,
        apiUrl: "http://example.test",
        getToken: () => "tok",
      }),
    ).rejects.toThrow(/network down/);

    expect(getLocalJob(handle.db, "net")).not.toBeNull();
  });
});
