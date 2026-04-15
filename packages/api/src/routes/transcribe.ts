import { Hono } from "hono";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import { optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { processAudioDirect } from "../services/container-service";

const transcribe = new Hono<Env>()
  .use("/*", optionalAuth())
  .use("/*", rateLimit({ max: 10, windowMs: 60_000 }))
  .post("/", async (c) => {
    if (!c.env.PROCESSOR) {
      throw new AppError(501, "NOT_IMPLEMENTED", "Audio processing is not yet available.");
    }

    const body = await c.req.parseBody();
    const file = body.audio;
    if (!(file instanceof File)) {
      throw new AppError(400, "BAD_REQUEST", "audio file is required");
    }

    const stream = file.stream();
    const contentType = file.type || "audio/mpeg";

    const result = await processAudioDirect(c.env.PROCESSOR, stream, contentType);

    return c.json({
      transcript: result.transcript,
      topics: result.topics,
    });
  });

export default transcribe;
