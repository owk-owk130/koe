import type { ErrorHandler } from "hono";
import type { Env } from "../types";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const onError: ErrorHandler<Env> = (err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }

  console.error("Unhandled error:", err);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
};
