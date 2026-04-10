import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from ".";

describe("GET /health", () => {
  it("returns status ok", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
