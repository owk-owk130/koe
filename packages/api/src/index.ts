import { Hono } from "hono";
import { cors } from "hono/cors";
import { onError } from "./lib/errors";
import authRoutes from "./routes/auth";
import jobsRoutes from "./routes/jobs";
import transcribeRoutes from "./routes/transcribe";
import uploadsRoutes from "./routes/uploads";
import type { Env } from "./types";

export { KoeProcessor } from "./container";

const app = new Hono<Env>()
  .use("/*", cors())
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/auth", authRoutes)
  .route("/api/v1/jobs", jobsRoutes)
  .route("/api/v1/transcribe", transcribeRoutes)
  .route("/api/v1/uploads", uploadsRoutes);

app.onError(onError);

export type AppType = typeof app;
export default app;
