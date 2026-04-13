import { Hono } from "hono";
import { cors } from "hono/cors";
import { onError } from "./lib/errors";
import authRoutes from "./routes/auth";
import jobsRoutes from "./routes/jobs";
import transcribeRoutes from "./routes/transcribe";
import type { Env } from "./types";

const app = new Hono<Env>();

app.use("/*", cors());
app.onError(onError);

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/auth", authRoutes);
app.route("/api/v1/jobs", jobsRoutes);
app.route("/api/v1/transcribe", transcribeRoutes);

export default app;
