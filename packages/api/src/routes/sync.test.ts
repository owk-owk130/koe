import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { onError } from "~/lib/errors";
import { findJobById, findTopicsByJob } from "~/repositories/job-repository";
import { createUser } from "~/repositories/user-repository";
import { signToken } from "~/services/auth-service";
import { downloadJSON } from "~/services/r2-storage";
import { setupD1 } from "~/test-helpers";
import type { Env } from "~/types";
import sync from "./sync";

const TEST_SECRET = "test-jwt-secret";
const makeEnv = () => ({ ...env, JWT_SECRET: TEST_SECRET });

const app = new Hono<Env>();
app.onError(onError);
app.route("/api/v1/sync", sync);

let token: string;

beforeAll(async () => {
  await setupD1();
  await createUser(env.DB, {
    id: "sync-user-1",
    googleId: "g-sync-1",
    email: "sync@test.com",
    name: "Sync User",
  });
  token = await signToken({ sub: "sync-user-1", email: "sync@test.com" }, TEST_SECRET);
});

const authHeaders = () => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const validBody = {
  audio_filename: "meeting.mp3",
  transcript: {
    text: "Hello world",
    segments: [{ text: "Hello world", start_sec: 0, end_sec: 5 }],
  },
};

describe("POST /api/v1/sync", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request(
      "/api/v1/sync",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 without audio_filename", async () => {
    const res = await app.request(
      "/api/v1/sync",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          transcript: { text: "Hello", segments: [] },
        }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 without transcript.text", async () => {
    const res = await app.request(
      "/api/v1/sync",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          audio_filename: "test.mp3",
          transcript: { text: "", segments: [] },
        }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 with empty body", async () => {
    const res = await app.request(
      "/api/v1/sync",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("creates a completed job with minimal body", async () => {
    const res = await app.request(
      "/api/v1/sync",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(validBody),
      },
      makeEnv(),
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      id: string;
      status: string;
      created_at: string;
    }>();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("completed");
    expect(body.created_at).toBeDefined();

    // Verify job in D1
    const job = await findJobById(env.DB, body.id);
    expect(job?.userId).toBe("sync-user-1");
    expect(job?.status).toBe("completed");
  });

  it("stores transcript and topics in R2", async () => {
    const bodyWithTopics = {
      ...validBody,
      summary: "Test summary",
      topics: [
        {
          index: 0,
          title: "Greeting",
          summary: "A greeting",
          start_sec: 0,
          end_sec: 5,
          transcript: "Hello world",
        },
      ],
    };

    const res = await app.request(
      "/api/v1/sync",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(bodyWithTopics),
      },
      makeEnv(),
    );
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    // Verify R2 transcript
    const transcript = await downloadJSON<{ text: string }>(
      env.BUCKET,
      `sync-user-1/results/${id}/transcript.json`,
    );
    expect(transcript?.text).toBe("Hello world");

    // Verify R2 topics
    const topics = await downloadJSON<Array<{ title: string; summary: string }>>(
      env.BUCKET,
      `sync-user-1/results/${id}/topics.json`,
    );
    expect(topics?.length).toBe(1);
    expect(topics?.[0].title).toBe("Greeting");
  });

  it("creates topics in D1", async () => {
    const bodyWithTopics = {
      ...validBody,
      topics: [
        {
          index: 0,
          title: "Topic A",
          summary: "Summary A",
          detail: "Detail A",
          start_sec: 0,
          end_sec: 3,
          transcript: "Text A",
        },
        {
          index: 1,
          title: "Topic B",
          summary: "Summary B",
          start_sec: 3,
          end_sec: 5,
          transcript: "Text B",
        },
      ],
    };

    const res = await app.request(
      "/api/v1/sync",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(bodyWithTopics),
      },
      makeEnv(),
    );
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    const topics = await findTopicsByJob(env.DB, id);
    expect(topics.length).toBe(2);
    expect(topics[0].title).toBe("Topic A");
    expect(topics[0].detail).toBe("Detail A");
    expect(topics[1].title).toBe("Topic B");
    expect(topics[1].detail).toBeNull();
  });

  it("accepts body without optional fields (topics, chunks, summary)", async () => {
    const res = await app.request(
      "/api/v1/sync",
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(validBody),
      },
      makeEnv(),
    );
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    const topics = await findTopicsByJob(env.DB, id);
    expect(topics.length).toBe(0);
  });
});
