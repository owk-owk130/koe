import { Hono } from "hono";
import type { Env } from "../types";
import { optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

const transcribe = new Hono<Env>();

transcribe.use("/*", optionalAuth());
transcribe.use("/*", rateLimit({ max: 10, windowMs: 60_000 }));

transcribe.post("/", (c) => {
  return c.json(
    {
      error: {
        code: "NOT_IMPLEMENTED",
        message:
          "Audio processing is not yet available. This endpoint will be enabled in a future release.",
      },
    },
    501,
  );
});

export default transcribe;
