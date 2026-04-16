import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { onError } from "~/lib/errors";
import { createUser } from "~/repositories/user-repository";
import { signToken } from "~/services/auth-service";
import { setupD1 } from "~/test-helpers";
import type { Env } from "~/types";
import uploads from "./uploads";

const TEST_SECRET = "test-jwt-secret";
const makeEnv = () => ({ ...env, JWT_SECRET: TEST_SECRET });

const app = new Hono<Env>();
app.onError(onError);
app.route("/api/v1/uploads", uploads);

let token: string;

beforeAll(async () => {
  await setupD1();
  await createUser(env.DB, {
    id: "upload-user-1",
    googleId: "g-upload-1",
    email: "upload@test.com",
    name: "Upload User",
  });
  token = await signToken({ sub: "upload-user-1", email: "upload@test.com" }, TEST_SECRET);
});

const authHeaders = () => ({ Authorization: `Bearer ${token}` });

describe("POST /api/v1/uploads", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/v1/uploads", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 400 without filename", async () => {
    const res = await app.request(
      "/api/v1/uploads",
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("initiates multipart upload", async () => {
    const res = await app.request(
      "/api/v1/uploads",
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "test.mp3" }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ upload_id: string; key: string }>();
    expect(body.upload_id).toBeDefined();
    expect(body.key).toContain("upload-user-1/audio/");
  });
});

describe("POST /api/v1/uploads/:uploadId/complete", () => {
  it("returns 400 without parts", async () => {
    const res = await app.request(
      "/api/v1/uploads/fake-upload-id/complete",
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });
});
