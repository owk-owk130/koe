import { Hono } from "hono";

type Bindings = {
  // DB: D1Database
  // BUCKET: R2Bucket
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ status: "ok" }));

// TODO: POST /api/v1/transcribe (public, optionalAuth)
// TODO: POST /api/v1/jobs (requireAuth)
// TODO: GET  /api/v1/jobs (requireAuth)
// TODO: GET  /api/v1/jobs/:id (requireAuth)
// TODO: GET  /api/v1/jobs/:id/topics (requireAuth)

export default app;
