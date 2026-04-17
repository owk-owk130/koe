import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "./index";
import { getLocalJob, listLocalJobs, saveLocalJob, type SaveLocalJobInput } from "./job-store";

const sampleInput = (overrides: Partial<SaveLocalJobInput> = {}): SaveLocalJobInput => ({
  id: "job-1",
  audioFilename: "meeting.mp3",
  audioDurationSec: 120.5,
  summary: "Sample summary",
  transcript: {
    text: "Full transcript text",
    segments: [
      { text: "Hello", start_sec: 0, end_sec: 2 },
      { text: "world", start_sec: 2, end_sec: 4 },
    ],
  },
  topics: [
    {
      index: 0,
      title: "Intro",
      summary: "Opening",
      detail: "Opening detail",
      start_sec: 0,
      end_sec: 60,
      transcript: "Hello everyone",
    },
    {
      index: 1,
      title: "Main",
      summary: "Core",
      detail: "Core detail",
      start_sec: 60,
      end_sec: 120,
      transcript: "Let us begin",
    },
  ],
  chunks: [
    { index: 0, start_sec: 0, end_sec: 60, text: "Hello everyone" },
    { index: 1, start_sec: 60, end_sec: 120, text: "Let us begin" },
  ],
  ...overrides,
});

describe("job-store", () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = createDatabase(":memory:");
  });

  it("saves a job with topics and chunks atomically", () => {
    saveLocalJob(handle.db, sampleInput());

    const detail = getLocalJob(handle.db, "job-1");
    expect(detail).not.toBeNull();
    expect(detail!.job.summary).toBe("Sample summary");
    expect(detail!.job.status).toBe("completed");
    expect(detail!.topics).toHaveLength(2);
    expect(detail!.topics[0].title).toBe("Intro");
    expect(detail!.chunks).toHaveLength(2);
    expect(detail!.chunks[1].transcript).toBe("Let us begin");
  });

  it("returns null for an unknown job", () => {
    expect(getLocalJob(handle.db, "missing")).toBeNull();
  });

  it("lists jobs newest first", () => {
    saveLocalJob(handle.db, sampleInput({ id: "old" }));
    // ensure a different created_at second is unnecessary since we use id ordering
    saveLocalJob(handle.db, sampleInput({ id: "new" }));

    const rows = listLocalJobs(handle.db);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("enqueues sync_state in pending for each saved job", () => {
    saveLocalJob(handle.db, sampleInput());
    const row = handle.db.$client
      .prepare("SELECT job_id, status FROM sync_state WHERE job_id = ?")
      .get("job-1") as { job_id: string; status: string } | undefined;
    expect(row?.status).toBe("pending");
  });
});
