import { Hono } from "hono";
import { cors } from "hono/cors";
import { onError } from "./lib/errors";
import authRoutes from "./routes/auth";
import jobsRoutes from "./routes/jobs";
import mcpRoutes from "./routes/mcp";
import syncRoutes from "./routes/sync";
import uploadsRoutes from "./routes/uploads";
import type { Env } from "./types";

// Localhost on any port (loopback over IPv4 / IPv6 / hostname) is echoed back
// explicitly so dev clients — Electron renderer under vite, curl from the
// host, neighboring local tools — get a precise Allow-Origin header that
// would still hold up if we later turn on credentials. Other origins fall
// back to "*" because the API authenticates with bearer tokens (no cookies),
// so CORS is not the security boundary.
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

const corsOrigin = (origin: string): string => {
  if (origin && LOCAL_ORIGIN.test(origin)) return origin;
  return "*";
};

const app = new Hono<Env>()
  .use("/*", cors({ origin: corsOrigin }))
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/auth", authRoutes)
  .route("/api/v1/jobs", jobsRoutes)
  .route("/api/v1/uploads", uploadsRoutes)
  .route("/api/v1/sync", syncRoutes)
  .route("/mcp", mcpRoutes);

app.onError(onError);

export type AppType = typeof app;
export default app;
