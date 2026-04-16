import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { onError } from "~/lib/errors";
import { setupD1 } from "~/test-helpers";
import type { Env } from "~/types";
import auth from "./auth";

const TEST_SECRET = "test-jwt-secret";
const makeEnv = () => ({
  ...env,
  JWT_SECRET: TEST_SECRET,
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
});

const app = new Hono<Env>();
app.onError(onError);
app.route("/auth", auth);

beforeAll(async () => {
  await setupD1();
});

describe("POST /auth/token", () => {
  it("returns 400 without device_code", async () => {
    const res = await app.request(
      "/auth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 428 when Google returns authorization_pending", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 403,
      }),
    );

    try {
      const res = await app.request(
        "/auth/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: "test-code" }),
        },
        makeEnv(),
      );
      expect(res.status).toBe(428);
      expect(await res.json()).toEqual({ status: "pending" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns token on successful auth", async () => {
    const originalFetch = globalThis.fetch;
    // Create a fake Google ID token
    const header = btoa(JSON.stringify({ alg: "RS256" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const payload = btoa(
      JSON.stringify({
        sub: "google-new-user",
        email: "new@gmail.com",
        name: "New User",
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const fakeIdToken = `${header}.${payload}.fakesig`;

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id_token: fakeIdToken, access_token: "access-token" }), {
        status: 200,
      }),
    );

    try {
      const res = await app.request(
        "/auth/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: "valid-code" }),
        },
        makeEnv(),
      );
      expect(res.status).toBe(200);
      const body = await res.json<{ token: string; user: { email: string } }>();
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe("new@gmail.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
