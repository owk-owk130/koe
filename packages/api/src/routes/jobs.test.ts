import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { setupD1 } from "../test-helpers";
import { onError } from "../lib/errors";
import { createUser } from "../repositories/user-repository";
import { createTopics } from "../repositories/job-repository";
import { signToken } from "../services/auth-service";
import jobs from "./jobs";
import type { Env } from "../types";

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
