import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { setupD1 } from "~/test-helpers";
import { createChunks, findChunksByJob } from "./chunk-repository";

beforeAll(async () => {
  await setupD1();
  await env.DB.prepare("INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)")
    .bind("u1", "g1", "user@test.com", "User")
    .run();
  await env.DB.prepare("INSERT INTO jobs (id, user_id, audio_key) VALUES (?, ?, ?)")
    .bind("job-1", "u1", "u1/audio/job-1/original.mp3")
    .run();
});

describe("chunk-repository", () => {
  it("creates and finds chunks", async () => {
    await createChunks(env.DB, "job-1", [
      {
        id: "chunk-1",
        chunkIndex: 0,
        audioKey: "u1/audio/job-1/chunks/0.mp3",
        startSec: 0,
        endSec: 30,
        transcript: "hello world",
      },
      {
        id: "chunk-2",
        chunkIndex: 1,
        audioKey: "u1/audio/job-1/chunks/1.mp3",
        startSec: 30,
        endSec: 60,
        transcript: "goodbye world",
      },
    ]);

    const chunks = await findChunksByJob(env.DB, "job-1");
    expect(chunks.length).toBe(2);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[0].endSec).toBe(30);
    expect(chunks[0].transcript).toBe("hello world");
    expect(chunks[1].chunkIndex).toBe(1);
    expect(chunks[1].transcript).toBe("goodbye world");
  });

  it("returns empty array for job with no chunks", async () => {
    const chunks = await findChunksByJob(env.DB, "nonexistent");
    expect(chunks).toEqual([]);
  });

  // D1 caps bound parameters at 100 per query. Each row binds 8 columns, so a
  // single-statement insert of >12 rows overflows the limit. The repository
  // must batch internally so callers can pass arbitrary lengths safely.
  it("inserts a large number of chunks in a single call", async () => {
    await env.DB.prepare("INSERT INTO jobs (id, user_id, audio_key) VALUES (?, ?, ?)")
      .bind("job-large", "u1", "u1/audio/job-large/original.mp3")
      .run();

    const inputs = Array.from({ length: 50 }, (_, i) => ({
      id: `large-chunk-${i}`,
      chunkIndex: i,
      audioKey: `u1/audio/job-large/chunks/${i}.mp3`,
      startSec: i * 60,
      endSec: (i + 1) * 60,
      transcript: `text ${i}`,
    }));

    await createChunks(env.DB, "job-large", inputs);

    const chunks = await findChunksByJob(env.DB, "job-large");
    expect(chunks.length).toBe(50);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[49].chunkIndex).toBe(49);
    expect(chunks[49].transcript).toBe("text 49");
  });
});
