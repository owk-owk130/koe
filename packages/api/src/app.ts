import { Hono } from "hono";
import { cors } from "hono/cors";
import { onError } from "./lib/errors";
import authRoutes from "./routes/auth";
import jobsRoutes from "./routes/jobs";
import mcpRoutes from "./routes/mcp";
import syncRoutes from "./routes/sync";
import transcribeRoutes from "./routes/transcribe";
import uploadsRoutes from "./routes/uploads";
import type { Env } from "./types";

const app = new Hono<Env>()
  .use("/*", cors())
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/auth", authRoutes)
  .route("/api/v1/jobs", jobsRoutes)
  .route("/api/v1/transcribe", transcribeRoutes)
  .route("/api/v1/uploads", uploadsRoutes)
  .route("/api/v1/sync", syncRoutes)
  .route("/mcp", mcpRoutes);

app.onError(onError);

export type AppType = typeof app;
export default app;
