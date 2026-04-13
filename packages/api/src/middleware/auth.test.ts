import { Hono } from "hono";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { setupD1 } from "../test-helpers";
import { signToken } from "../services/auth-service";
import { createUser } from "../repositories/user-repository";
import { requireAuth, optionalAuth } from "./auth";
import type { Env } from "../types";

const TEST_SECRET = "test-jwt-secret";

const makeEnv = () => ({ ...env, JWT_SECRET: TEST_SECRET });

beforeAll(async () => {
  await setupD1();
  await createUser(env.DB, {
    id: "auth-user-1",
    googleId: "g-auth-1",
    email: "auth@test.com",
    name: "Auth User",
  });
});

describe("requireAuth", () => {
  const app = new Hono<Env>();
  app.use("/protected/*", requireAuth());
  app.get("/protected/data", (c) => {
    const user = c.get("user");
    return c.json({ userId: user!.id });
  });

  it("returns 401 without token", async () => {
    const res = await app.request("/protected/data", {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const res = await app.request(
      "/protected/data",
      { headers: { Authorization: "Bearer invalid-token" } },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when user not found", async () => {
    const token = await signToken({ sub: "nonexistent-user", email: "no@test.com" }, TEST_SECRET);
    const res = await app.request(
      "/protected/data",
      { headers: { Authorization: `Bearer ${token}` } },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("allows access with valid token", async () => {
    const token = await signToken({ sub: "auth-user-1", email: "auth@test.com" }, TEST_SECRET);
    const res = await app.request(
      "/protected/data",
      { headers: { Authorization: `Bearer ${token}` } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "auth-user-1" });
  });
});

describe("optionalAuth", () => {
  const app = new Hono<Env>();
  app.use("/optional/*", optionalAuth());
  app.get("/optional/data", (c) => {
    const user = c.get("user");
    return c.json({ userId: user?.id ?? null });
  });

  it("allows access without token", async () => {
    const res = await app.request("/optional/data", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: null });
  });

  it("sets user with valid token", async () => {
    const token = await signToken({ sub: "auth-user-1", email: "auth@test.com" }, TEST_SECRET);
    const res = await app.request(
      "/optional/data",
      { headers: { Authorization: `Bearer ${token}` } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "auth-user-1" });
  });

  it("returns 401 with invalid token", async () => {
    const res = await app.request(
      "/optional/data",
      { headers: { Authorization: "Bearer bad-token" } },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});
