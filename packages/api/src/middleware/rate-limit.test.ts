import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "~/types";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows requests within limit", async () => {
    const app = new Hono<Env>();
    app.use("/*", rateLimit({ max: 3, windowMs: 60_000 }));
    app.get("/test", (c) => c.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      // sequential required to exercise the in-memory rate-limit counter
      // oxlint-disable-next-line no-await-in-loop
      const res = await app.request("/test", {
        headers: { "X-Forwarded-For": "1.2.3.4" },
      });
      expect(res.status).toBe(200);
    }
  });

  it("blocks requests exceeding limit", async () => {
    const app = new Hono<Env>();
    app.use("/*", rateLimit({ max: 2, windowMs: 60_000 }));
    app.get("/test", (c) => c.json({ ok: true }));

    // Use a unique IP so tests don't interfere with each other
    const headers = { "X-Forwarded-For": "10.0.0.1" };

    await app.request("/test", { headers });
    await app.request("/test", { headers });
    const res = await app.request("/test", { headers });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
  });
});
