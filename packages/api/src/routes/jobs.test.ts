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

interface ChunkSpec {
  index: number;
  startSec: number;
  endSec: number;
  data?: Uint8Array;
  skipFile?: boolean;
}

const buildJobForm = (
  opts: {
    chunks?: ChunkSpec[];
    durationSec?: number;
    rawMeta?: string;
    skipMeta?: boolean;
    skipOriginal?: boolean;
    originalData?: Uint8Array;
    originalType?: string;
    originalFilename?: string;
  } = {},
): FormData => {
  const form = new FormData();
  const chunks = opts.chunks ?? [{ index: 0, startSec: 0, endSec: 1 }];
  if (!opts.skipMeta) {
    const meta =
      opts.rawMeta ??
      JSON.stringify(
        chunks.map((c) => ({ index: c.index, startSec: c.startSec, endSec: c.endSec })),
      );
    form.append("chunks_meta", meta);
  }
  if (opts.durationSec !== undefined) {
    form.append("duration_sec", String(opts.durationSec));
  }
  if (!opts.skipOriginal) {
    form.append(
      "original",
      new File(
        [opts.originalData ?? new Uint8Array([9, 9, 9])],
        opts.originalFilename ?? "original.webm",
        { type: opts.originalType ?? "audio/webm" },
      ),
    );
  }
  for (const c of chunks) {
    if (c.skipFile) continue;
    form.append(
      `chunk_${c.index}`,
      new File([c.data ?? new Uint8Array([1, 2, 3])], `chunk_${c.index}.wav`, {
        type: "audio/wav",
      }),
    );
  }
  return form;
};

describe("POST /api/v1/jobs", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/v1/jobs", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 400 when chunks_meta is missing", async () => {
    const form = buildJobForm({ skipMeta: true });
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when chunks_meta is invalid JSON", async () => {
    const form = buildJobForm({ rawMeta: "{not json" });
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when chunks_meta is empty", async () => {
    const form = new FormData();
    form.append("chunks_meta", "[]");
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the original audio file is missing", async () => {
    const form = buildJobForm({ skipOriginal: true });
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when a chunk has endSec <= startSec", async () => {
    const form = buildJobForm({
      chunks: [{ index: 0, startSec: 10, endSec: 10 }],
    });
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when chunk indices are duplicated", async () => {
    const form = buildJobForm({
      chunks: [
        { index: 0, startSec: 0, endSec: 60 },
        { index: 0, startSec: 60, endSec: 90 },
      ],
    });
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when duration_sec is not a finite non-negative number", async () => {
    const form = buildJobForm({});
    form.set("duration_sec", "not-a-number");
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(400);

    const form2 = buildJobForm({});
    form2.set("duration_sec", "-5");
    const res2 = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form2 },
      makeEnv(),
    );
    expect(res2.status).toBe(400);
  });

  it("returns 400 when a chunk file is missing for the declared index", async () => {
    const form = buildJobForm({
      chunks: [
        { index: 0, startSec: 0, endSec: 60 },
        { index: 1, startSec: 60, endSec: 90, skipFile: true },
      ],
    });
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("creates a job with chunks and persists original + each chunk to R2 and D1", async () => {
    const form = buildJobForm({
      chunks: [
        { index: 0, startSec: 0, endSec: 60, data: new Uint8Array([1, 2, 3]) },
        { index: 1, startSec: 60, endSec: 90, data: new Uint8Array([4, 5, 6]) },
      ],
      durationSec: 90,
      originalData: new Uint8Array([7, 8, 9, 10]),
    });
    const res = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: form },
      makeEnv(),
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; status: string; audio_key: string }>();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("pending");
    expect(body.audio_key).toBe(`jobs-user-1/audio/${body.id}/original.webm`);

    const original = await env.BUCKET.get(body.audio_key);
    expect(original).not.toBeNull();
    expect(await original?.arrayBuffer()).toEqual(new Uint8Array([7, 8, 9, 10]).buffer);

    const chunk0 = await env.BUCKET.get(`jobs-user-1/audio/${body.id}/chunks/0.wav`);
    const chunk1 = await env.BUCKET.get(`jobs-user-1/audio/${body.id}/chunks/1.wav`);
    expect(chunk0).not.toBeNull();
    expect(chunk1).not.toBeNull();

    const rows = await env.DB.prepare(
      "SELECT chunk_index, audio_key, start_sec, end_sec FROM chunks WHERE job_id = ? ORDER BY chunk_index",
    )
      .bind(body.id)
      .all<{ chunk_index: number; audio_key: string; start_sec: number; end_sec: number }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]).toMatchObject({
      chunk_index: 0,
      audio_key: `jobs-user-1/audio/${body.id}/chunks/0.wav`,
      start_sec: 0,
      end_sec: 60,
    });
    expect(rows.results[1].chunk_index).toBe(1);

    const jobRow = await env.DB.prepare(
      "SELECT total_chunks, audio_duration_sec FROM jobs WHERE id = ?",
    )
      .bind(body.id)
      .first<{ total_chunks: number; audio_duration_sec: number }>();
    expect(jobRow?.total_chunks).toBe(2);
    expect(jobRow?.audio_duration_sec).toBe(90);
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
    const createRes = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: buildJobForm() },
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
    const createRes = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: buildJobForm() },
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

describe("GET /api/v1/jobs/:id/audio", () => {
  const seedJob = async (id: string, audioKey: string, userId = "jobs-user-1") => {
    await env.DB.prepare("INSERT INTO jobs (id, user_id, status, audio_key) VALUES (?, ?, ?, ?)")
      .bind(id, userId, "completed", audioKey)
      .run();
  };

  it("returns 401 without auth", async () => {
    await seedJob("au-401", "jobs-user-1/audio/au-401/original.webm");
    const res = await app.request("/api/v1/jobs/au-401/audio", {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the job belongs to another user", async () => {
    await createUser(env.DB, {
      id: "jobs-user-other-au",
      googleId: "g-jobs-other-au",
      email: "other-au@test.com",
      name: "Other",
    });
    const key = "jobs-user-other-au/audio/au-other/original.webm";
    await seedJob("au-other", key, "jobs-user-other-au");
    await env.BUCKET.put(key, new Uint8Array([1, 2, 3]));

    const res = await app.request(
      "/api/v1/jobs/au-other/audio",
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the original is missing in R2", async () => {
    await seedJob("au-missing", "jobs-user-1/audio/au-missing/original.webm");
    const res = await app.request(
      "/api/v1/jobs/au-missing/audio",
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("streams the original audio bytes from R2", async () => {
    const key = "jobs-user-1/audio/au-ok/original.webm";
    await seedJob("au-ok", key);
    await env.BUCKET.put(key, new Uint8Array([1, 2, 3, 4, 5]), {
      httpMetadata: { contentType: "audio/webm" },
    });

    const res = await app.request(
      "/api/v1/jobs/au-ok/audio",
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/webm");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });
});

describe("GET /api/v1/jobs/:id/transcript", () => {
  const seedJob = async (id: string, transcriptKey: string | null, userId = "jobs-user-1") => {
    await env.DB.prepare(
      "INSERT INTO jobs (id, user_id, status, audio_key, transcript_key) VALUES (?, ?, 'completed', ?, ?)",
    )
      .bind(id, userId, `${userId}/audio/${id}/original.mp3`, transcriptKey)
      .run();
  };

  it("returns 401 without auth", async () => {
    await seedJob("tx-401", "jobs-user-1/results/tx-401/transcript.json");
    const res = await app.request("/api/v1/jobs/tx-401/transcript", {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the job belongs to another user", async () => {
    await createUser(env.DB, {
      id: "jobs-user-other-tx",
      googleId: "g-jobs-other-tx",
      email: "other-tx@test.com",
      name: "Other",
    });
    const key = "jobs-user-other-tx/results/tx-other/transcript.json";
    await seedJob("tx-other", key, "jobs-user-other-tx");
    await env.BUCKET.put(key, JSON.stringify({ text: "secret", segments: [] }));

    const res = await app.request(
      "/api/v1/jobs/tx-other/transcript",
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the job has no transcript_key yet", async () => {
    await seedJob("tx-no-key", null);
    const res = await app.request(
      "/api/v1/jobs/tx-no-key/transcript",
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the transcript_key points at a missing R2 object", async () => {
    await seedJob("tx-missing", "jobs-user-1/results/tx-missing/transcript.json");
    const res = await app.request(
      "/api/v1/jobs/tx-missing/transcript",
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("returns the transcript text and segments from R2", async () => {
    const key = "jobs-user-1/results/tx-ok/transcript.json";
    await seedJob("tx-ok", key);
    await env.BUCKET.put(
      key,
      JSON.stringify({
        text: "hello\nworld",
        segments: [
          { text: "hello", start_sec: 0, end_sec: 1 },
          { text: "world", start_sec: 1, end_sec: 2 },
        ],
      }),
    );

    const res = await app.request(
      "/api/v1/jobs/tx-ok/transcript",
      { headers: authHeaders() },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      text: string;
      segments: { text: string; start_sec: number; end_sec: number }[];
    }>();
    expect(body.text).toBe("hello\nworld");
    expect(body.segments).toHaveLength(2);
    expect(body.segments[0].text).toBe("hello");
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
    const createRes = await app.request(
      "/api/v1/jobs",
      { method: "POST", headers: authHeaders(), body: buildJobForm() },
      makeEnv(),
    );
    const { id: jobId } = await createRes.json<{ id: string }>();
    const chunkKey = `jobs-user-1/audio/${jobId}/chunks/0.wav`;
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
    expect(await env.BUCKET.get(chunkKey)).not.toBeNull();
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
    expect(await env.BUCKET.get(chunkKey)).toBeNull();
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
