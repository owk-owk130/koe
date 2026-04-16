import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "~/types";
import { AppError, onError } from "./errors";

describe("AppError", () => {
  const app = new Hono<Env>();
  app.onError(onError);

  app.get("/app-error", () => {
    throw new AppError(400, "BAD_REQUEST", "Invalid input");
  });

  app.get("/not-found", () => {
    throw new AppError(404, "NOT_FOUND", "Resource not found");
  });

  app.get("/gone", () => {
    throw new AppError(410, "EXPIRED", "Resource expired");
  });

  app.get("/unknown-error", () => {
    throw new Error("something broke");
  });

  it("returns structured error for AppError", async () => {
    const res = await app.request("/app-error");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "BAD_REQUEST", message: "Invalid input" },
    });
  });

  it("returns correct status for non-400 AppError", async () => {
    const res404 = await app.request("/not-found");
    expect(res404.status).toBe(404);

    const res410 = await app.request("/gone");
    expect(res410.status).toBe(410);
  });

  it("returns 500 for unknown errors", async () => {
    const res = await app.request("/unknown-error");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
