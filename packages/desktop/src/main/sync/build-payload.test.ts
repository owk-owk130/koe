import { describe, expect, it } from "vitest";
import type { Chunk, Job, Topic } from "~/main/db/schema";
import { buildSyncPayload } from "./build-payload";

const baseJob = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1",
  userId: "local",
  status: "completed",
  audioKey: "local/audio/job-1/meeting.mp3",
  audioDurationSec: 120,
  totalChunks: 2,
  completedChunks: 2,
  error: null,
  summary: "sample summary",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const baseTopic = (index: number, overrides: Partial<Topic> = {}): Topic => ({
  id: `topic-${index}`,
  jobId: "job-1",
  topicIndex: index,
  title: `Topic ${index}`,
  summary: "summary",
  detail: "detail",
  startSec: index * 60,
  endSec: (index + 1) * 60,
  transcript: "topic transcript",
  transcriptKey: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const baseChunk = (index: number, overrides: Partial<Chunk> = {}): Chunk => ({
  id: `chunk-${index}`,
  jobId: "job-1",
  chunkIndex: index,
  status: "completed",
  audioKey: `local/audio/job-1/chunks/${index}.mp3`,
  startSec: index * 60,
  endSec: (index + 1) * 60,
  transcript: `chunk ${index} text`,
  transcriptKey: null,
  error: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("buildSyncPayload", () => {
  it("derives audio_filename from audioKey", () => {
    const payload = buildSyncPayload({
      job: baseJob({ audioKey: "local/audio/job-1/recording.webm" }),
      topics: [],
      chunks: [],
    });
    expect(payload.audio_filename).toBe("recording.webm");
  });

  it("joins chunk transcripts for transcript.text", () => {
    const payload = buildSyncPayload({
      job: baseJob(),
      topics: [],
      chunks: [baseChunk(0, { transcript: "Hello" }), baseChunk(1, { transcript: "world" })],
    });
    expect(payload.transcript.text).toBe("Hello\nworld");
  });

  it("maps chunks to transcript.segments with snake_case seconds", () => {
    const payload = buildSyncPayload({
      job: baseJob(),
      topics: [],
      chunks: [baseChunk(0, { transcript: "hi", startSec: 1.5, endSec: 3.0 })],
    });
    expect(payload.transcript.segments).toEqual([{ text: "hi", start_sec: 1.5, end_sec: 3.0 }]);
  });

  it("maps topics and chunks with snake_case for API compatibility", () => {
    const payload = buildSyncPayload({
      job: baseJob(),
      topics: [baseTopic(0, { startSec: 0, endSec: 60, detail: "d" })],
      chunks: [baseChunk(0)],
    });
    expect(payload.topics).toEqual([
      {
        index: 0,
        title: "Topic 0",
        summary: "summary",
        detail: "d",
        start_sec: 0,
        end_sec: 60,
        transcript: "topic transcript",
      },
    ]);
    expect(payload.chunks).toEqual([{ index: 0, start_sec: 0, end_sec: 60, text: "chunk 0 text" }]);
  });

  it("omits summary when null", () => {
    const payload = buildSyncPayload({
      job: baseJob({ summary: null }),
      topics: [],
      chunks: [],
    });
    expect(payload.summary).toBeUndefined();
  });

  it("produces a non-empty transcript.text for jobs with no chunks", () => {
    // API requires transcript.text.min(1); fall back to summary or placeholder.
    const payload = buildSyncPayload({
      job: baseJob({ summary: "fallback" }),
      topics: [],
      chunks: [],
    });
    expect(payload.transcript.text.length).toBeGreaterThan(0);
  });
});
