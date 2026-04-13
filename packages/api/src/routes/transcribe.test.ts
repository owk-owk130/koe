import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { setupD1 } from "../test-helpers";
import { onError } from "../lib/errors";
import transcribe from "./transcribe";
import type { Env } from "../types";

const TEST_SECRET = "test-jwt-secret";
const makeEnv = () => ({ ...env, JWT_SECRET: TEST_SECRET });

const app = new Hono<Env>();
app.onError(onError);
app.route("/api/v1/transcribe", transcribe);

beforeAll(async () => {
  await setupD1();
});

describe("POST /api/v1/transcribe", () => {
  it("returns 501 Not Implemented", async () => {
    const res = await app.request("/api/v1/transcribe", { method: "POST" }, makeEnv());
    expect(res.status).toBe(501);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("NOT_IMPLEMENTED");
  });

  it("works without auth token", async () => {
    const res = await app.request("/api/v1/transcribe", { method: "POST" }, makeEnv());
    expect(res.status).toBe(501);
  });
});
