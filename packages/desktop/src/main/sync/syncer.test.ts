import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseHandle } from "~/main/db";
import { saveLocalJob } from "~/main/db/job-store";
import { getSyncState, listPendingSyncs } from "~/main/db/sync-state";
import { syncPendingJobs } from "./syncer";

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

const makeFetch = (responses: Array<Response | Error>) => {
  const queue = [...responses];
  return vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch call");
    if (next instanceof Error) throw next;
    return next;
  });
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

describe("syncPendingJobs", () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = createDatabase(":memory:");
  });

  it("skips entirely when no token is available", async () => {
    seedJob(handle, "a");
    const fetchMock = vi.fn();
    const result = await syncPendingJobs(handle.db, {
      fetch: fetchMock as unknown as typeof fetch,
      apiUrl: "http://example.test",
      getToken: () => null,
    });
    expect(result).toEqual({ synced: 0, failed: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks a job synced when API returns 201 with job id", async () => {
    seedJob(handle, "a");
    const fetchMock = makeFetch([
      jsonResponse(
        { id: "cloud-id-1", status: "completed", created_at: "2026-04-17" },
        { status: 201 },
      ),
    ]);

    const result = await syncPendingJobs(handle.db, {
      fetch: fetchMock as unknown as typeof fetch,
      apiUrl: "http://example.test",
      getToken: () => "tok",
    });

    expect(result).toEqual({ synced: 1, failed: 0, skipped: 0 });
    const state = getSyncState(handle.db, "a");
    expect(state?.status).toBe("synced");
    expect(state?.cloudJobId).toBe("cloud-id-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://example.test/api/v1/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
  });

  it("increments retry count when API returns 5xx", async () => {
    seedJob(handle, "a");
    const fetchMock = makeFetch([jsonResponse({ error: "boom" }, { status: 500 })]);

    const result = await syncPendingJobs(handle.db, {
      fetch: fetchMock as unknown as typeof fetch,
      apiUrl: "http://example.test",
      getToken: () => "tok",
    });

    expect(result).toEqual({ synced: 0, failed: 1, skipped: 0 });
    const state = getSyncState(handle.db, "a");
    expect(state?.status).toBe("pending");
    expect(state?.retryCount).toBe(1);
    expect(state?.lastError).toMatch(/500/);
    // still pending so it shows up for next attempt
    expect(listPendingSyncs(handle.db).length).toBe(1);
  });

  it("increments retry count when fetch throws (network error)", async () => {
    seedJob(handle, "a");
    const fetchMock = makeFetch([new Error("network down")]);

    const result = await syncPendingJobs(handle.db, {
      fetch: fetchMock as unknown as typeof fetch,
      apiUrl: "http://example.test",
      getToken: () => "tok",
    });

    expect(result).toEqual({ synced: 0, failed: 1, skipped: 0 });
    const state = getSyncState(handle.db, "a");
    expect(state?.retryCount).toBe(1);
    expect(state?.lastError).toMatch(/network down/);
  });

  it("processes multiple pending jobs in one pass", async () => {
    seedJob(handle, "a");
    seedJob(handle, "b");
    const fetchMock = makeFetch([
      jsonResponse({ id: "cloud-a", status: "completed", created_at: "" }, { status: 201 }),
      jsonResponse({ id: "cloud-b", status: "completed", created_at: "" }, { status: 201 }),
    ]);

    const result = await syncPendingJobs(handle.db, {
      fetch: fetchMock as unknown as typeof fetch,
      apiUrl: "http://example.test",
      getToken: () => "tok",
    });

    expect(result).toEqual({ synced: 2, failed: 0, skipped: 0 });
    expect(getSyncState(handle.db, "a")?.cloudJobId).toBe("cloud-a");
    expect(getSyncState(handle.db, "b")?.cloudJobId).toBe("cloud-b");
  });
});
