import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from ".";

const makeEnv = () => ({ ...env, JWT_SECRET: "test-secret" });

describe("GET /health", () => {
  it("returns status ok", async () => {
    const res = await app.request("/health", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("CORS", () => {
  it("includes CORS headers", async () => {
    const res = await app.request(
      "/health",
      { headers: { Origin: "http://localhost:3000" } },
      makeEnv(),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("route mounting", () => {
  it("GET /api/v1/jobs returns 401 without auth", async () => {
    const res = await app.request("/api/v1/jobs", {}, makeEnv());
    expect(res.status).toBe(401);
  });
});
