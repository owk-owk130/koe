import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { onError } from "~/lib/errors";
import { createTopics } from "~/repositories/job-repository";
import { createUser } from "~/repositories/user-repository";
import { signToken } from "~/services/auth-service";
import { setupD1 } from "~/test-helpers";
import type { Env } from "~/types";
import jobs from "./jobs";

const TEST_SECRET = "test-jwt-secret";
const makeEnv = () => ({ ...env, JWT_SECRET: TEST_SECRET });

const app = new Hono<Env>();
app.onError(onError);
app.route("/api/v1/jobs", jobs);

let token: string;

beforeAll(async () => {
  await setupD1();
  await createUser(env.DB, {
    id: "jobs-user-1",
    googleId: "g-jobs-1",
    email: "jobs@test.com",
    name: "Jobs User",
  });
  token = await signToken({ sub: "jobs-user-1", email: "jobs@test.com" }, TEST_SECRET);
});

const authHeaders = () => ({ Authorization: `Bearer ${token}` });

describe("POST /api/v1/jobs", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/v1/jobs", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 400 without audio file", async () => {
    const form = new FormData();
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("creates a job with audio file", async () => {
    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1, 2, 3])], "test.mp3"));
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; status: string }>();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("pending");
  });
});

describe("GET /api/v1/jobs", () => {
  it("lists user jobs", async () => {
    const res = await app.request("/api/v1/jobs", { headers: authHeaders() }, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json<{ jobs: unknown[] }>();
    expect(body.jobs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/v1/jobs/:id", () => {
  it("returns job detail", async () => {
    // Create a job first
    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1])], "detail.mp3"));
    const createRes = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    const { id } = await createRes.json<{ id: string }>();

    const res = await app.request(`/api/v1/jobs/${id}`, { headers: authHeaders() }, makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json<{ id: string; status: string }>();
    expect(body.id).toBe(id);
  });

  it("returns 404 for non-existent job", async () => {
    const res = await app.request(
      "/api/v1/jobs/nonexistent",
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/jobs/:id/topics", () => {
  it("returns topics for a job", async () => {
    // Create a job
    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1])], "topics.mp3"));
    const createRes = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    const { id: jobId } = await createRes.json<{ id: string }>();

    // Add topics
    await createTopics(env.DB, jobId, [
      {
        id: crypto.randomUUID(),
        topicIndex: 0,
        title: "Topic A",
        transcript: "Text A",
      },
    ]);

    const res = await app.request(
      `/api/v1/jobs/${jobId}/topics`,
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ topics: { title: string }[] }>();
    expect(body.topics.length).toBe(1);
    expect(body.topics[0].title).toBe("Topic A");
  });
});

describe("DELETE /api/v1/jobs/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/v1/jobs/some-id", { method: "DELETE" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent job", async () => {
    const res = await app.request(
      "/api/v1/jobs/does-not-exist",
      { method: "DELETE", headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("deletes the job, its topics, and R2 objects", async () => {
    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1, 2, 3])], "del.mp3"));
    const createRes = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    const { id: jobId } = await createRes.json<{ id: string }>();
    const audioKey = `jobs-user-1/audio/${jobId}/original.mp3`;
    const resultKey = `jobs-user-1/results/${jobId}/transcript.json`;

    // Seed topic + a result JSON so we can verify both prefixes are purged.
    await createTopics(env.DB, jobId, [
      {
        id: crypto.randomUUID(),
        topicIndex: 0,
        title: "to delete",
        transcript: "body",
      },
    ]);
    await env.BUCKET.put(resultKey, JSON.stringify({ text: "t" }));

    // Pre-conditions
    expect(await env.BUCKET.get(audioKey)).not.toBeNull();
    expect(await env.BUCKET.get(resultKey)).not.toBeNull();

    const res = await app.request(
      `/api/v1/jobs/${jobId}`,
      { method: "DELETE", headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(204);

    // Job is gone
    const getRes = await app.request(
      `/api/v1/jobs/${jobId}`,
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(getRes.status).toBe(404);

    // R2 objects are gone
    expect(await env.BUCKET.get(audioKey)).toBeNull();
    expect(await env.BUCKET.get(resultKey)).toBeNull();
  });

  it("returns 404 when deleting another user's job", async () => {
    await createUser(env.DB, {
      id: "jobs-user-other",
      googleId: "g-jobs-other",
      email: "other@test.com",
      name: "Other",
    });
    await env.DB.prepare("INSERT INTO jobs (id, user_id, audio_key) VALUES (?, ?, ?)")
      .bind("other-job", "jobs-user-other", "jobs-user-other/audio/other-job/original.mp3")
      .run();

    const res = await app.request(
      "/api/v1/jobs/other-job",
      { method: "DELETE", headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);

    // still there
    const rows = await env.DB.prepare("SELECT id FROM jobs WHERE id = ?").bind("other-job").all();
    expect(rows.results.length).toBe(1);
  });
});

describe("POST /api/v1/jobs/:id/analyze", () => {
  const insertJobInState = async (id: string, status: string, userId = "jobs-user-1") => {
    await env.DB.prepare(
      "INSERT INTO jobs (id, user_id, status, audio_key, transcript_key) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        userId,
        status,
        `${userId}/audio/${id}/original.mp3`,
        `${userId}/results/${id}/transcript.json`,
      )
      .run();
  };

  it("returns 401 without auth", async () => {
    await insertJobInState("an-401", "transcribed");
    const res = await app.request("/api/v1/jobs/an-401/analyze", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 404 for a job owned by someone else", async () => {
    await createUser(env.DB, {
      id: "jobs-user-other-2",
      googleId: "g-jobs-other-2",
      email: "other2@test.com",
      name: "Other",
    });
    await insertJobInState("an-other", "transcribed", "jobs-user-other-2");

    const res = await app.request(
      "/api/v1/jobs/an-other/analyze",
      { method: "POST", headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-existent job", async () => {
    const res = await app.request(
      "/api/v1/jobs/nope/analyze",
      { method: "POST", headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 when the job has not finished transcribing", async () => {
    await insertJobInState("an-409", "transcribing");
    const res = await app.request(
      "/api/v1/jobs/an-409/analyze",
      { method: "POST", headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(409);
  });

  it("returns 202 when the job is transcribed", async () => {
    await insertJobInState("an-202-tx", "transcribed");
    const res = await app.request(
      "/api/v1/jobs/an-202-tx/analyze",
      { method: "POST", headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(202);
  });

  it("returns 202 when the job previously failed analyze", async () => {
    await insertJobInState("an-202-failed", "analyze_failed");
    const res = await app.request(
      "/api/v1/jobs/an-202-failed/analyze",
      { method: "POST", headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(202);
  });

  // Re-running analyze on a completed job is the regenerate-after-success
  // workflow (e.g. trying a new prompt against an already analyzed meeting).
  it("returns 202 when the job is completed (regenerate)", async () => {
    await insertJobInState("an-202-completed", "completed");
    const res = await app.request(
      "/api/v1/jobs/an-202-completed/analyze",
      { method: "POST", headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(202);
  });
});
