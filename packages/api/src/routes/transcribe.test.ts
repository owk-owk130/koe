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
  it("returns 400 without audio file", async () => {
    const form = new FormData();
    const res = await app.request("/api/v1/transcribe", { method: "POST", body: form }, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 501 when PROCESSOR binding is not available", async () => {
    const envWithoutProcessor = { ...makeEnv(), PROCESSOR: undefined };
    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1, 2, 3])], "test.mp3"));
    const res = await app.request(
      "/api/v1/transcribe",
      { method: "POST", body: form },
      envWithoutProcessor,
    );
    expect(res.status).toBe(501);
  });

  it("works without auth token (optionalAuth)", async () => {
    const form = new FormData();
    const res = await app.request("/api/v1/transcribe", { method: "POST", body: form }, makeEnv());
    // Should get 400 (no audio) not 401 (unauthorized)
    expect(res.status).toBe(400);
  });
});
