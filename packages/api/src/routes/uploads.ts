import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "~/lib/errors";
import { validate } from "~/lib/validation";
import { requireAuth } from "~/middleware/auth";
import type { Env } from "~/types";

const createSchema = z.object({
  filename: z.string().min(1),
});

const partParamSchema = z.object({
  uploadId: z.string(),
  partNumber: z.coerce.number().int().positive(),
});

const partQuerySchema = z.object({
  key: z.string().min(1),
});

const completeSchema = z.object({
  key: z.string().min(1),
  parts: z
    .array(
      z.object({
        part_number: z.number().int().positive(),
        etag: z.string(),
      }),
    )
    .min(1),
});

const uploads = new Hono<Env>()
  .use("/*", requireAuth())
  .post("/", validate("json", createSchema), async (c) => {
    const { filename } = c.req.valid("json");

    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const jobId = crypto.randomUUID();
    const ext = filename.split(".").pop() ?? "mp3";
    const key = `${user.id}/audio/${jobId}/original.${ext}`;

    const upload = await c.env.BUCKET.createMultipartUpload(key);

    return c.json({
      upload_id: upload.uploadId,
      key,
      job_id: jobId,
    });
  })
  .put(
    "/:uploadId/parts/:partNumber",
    validate("param", partParamSchema),
    validate("query", partQuerySchema),
    async (c) => {
      const { uploadId, partNumber } = c.req.valid("param");
      const { key } = c.req.valid("query");

      if (!c.req.raw.body) {
        throw new AppError(400, "BAD_REQUEST", "request body is required");
      }

      const upload = c.env.BUCKET.resumeMultipartUpload(key, uploadId);
      const part = await upload.uploadPart(partNumber, c.req.raw.body);

      return c.json({
        part_number: part.partNumber,
        etag: part.etag,
      });
    },
  )
  .post("/:uploadId/complete", validate("json", completeSchema), async (c) => {
    const uploadId = c.req.param("uploadId");
    const { key, parts } = c.req.valid("json");

    const upload = c.env.BUCKET.resumeMultipartUpload(key, uploadId);
    await upload.complete(
      parts.map((p) => ({
        partNumber: p.part_number,
        etag: p.etag,
      })),
    );

    return c.json({ key, status: "completed" });
  })
  .delete("/:uploadId", validate("query", partQuerySchema), async (c) => {
    const uploadId = c.req.param("uploadId");
    const { key } = c.req.valid("query");

    const upload = c.env.BUCKET.resumeMultipartUpload(key, uploadId);
    await upload.abort();

    return c.json({ status: "aborted" });
  });

export default uploads;
