import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "~/lib/errors";
import { validate } from "~/lib/validation";
import { optionalAuth } from "~/middleware/auth";
import { rateLimit } from "~/middleware/rate-limit";
import { processAudioDirect } from "~/services/container-service";
import type { Env } from "~/types";

const audioFormSchema = z.object({
  audio: z.instanceof(File),
});

const transcribe = new Hono<Env>()
  .use("/*", optionalAuth())
  .use("/*", rateLimit({ max: 10, windowMs: 60_000 }))
  .post("/", validate("form", audioFormSchema), async (c) => {
    if (!c.env.PROCESSOR) {
      throw new AppError(501, "NOT_IMPLEMENTED", "Audio processing is not yet available.");
    }

    const { audio: file } = c.req.valid("form");
    const stream = file.stream();
    const contentType = file.type || "audio/mpeg";

    const result = await processAudioDirect(c.env.PROCESSOR, stream, contentType);

    return c.json({
      transcript: result.transcript,
      topics: result.topics,
    });
  });

export default transcribe;
