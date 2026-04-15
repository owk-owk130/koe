import { Hono } from "hono";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";

const uploads = new Hono<Env>()
  .use("/*", requireAuth())
  .post("/", async (c) => {
    const body = await c.req.json<{ filename?: string }>();
    if (!body.filename) {
      throw new AppError(400, "BAD_REQUEST", "filename is required");
    }

    const user = c.get("user");
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const jobId = crypto.randomUUID();
    const ext = body.filename.split(".").pop() ?? "mp3";
    const key = `${user.id}/audio/${jobId}/original.${ext}`;

    const upload = await c.env.BUCKET.createMultipartUpload(key);

    return c.json({
      upload_id: upload.uploadId,
      key,
      job_id: jobId,
    });
  })
  .put("/:uploadId/parts/:partNumber", async (c) => {
    const uploadId = c.req.param("uploadId");
    const partNumber = parseInt(c.req.param("partNumber"), 10);
    const key = c.req.query("key");

    if (!key) {
      throw new AppError(400, "BAD_REQUEST", "key query parameter is required");
    }
    if (Number.isNaN(partNumber) || partNumber < 1) {
      throw new AppError(400, "BAD_REQUEST", "invalid part number");
    }

    if (!c.req.raw.body) {
      throw new AppError(400, "BAD_REQUEST", "request body is required");
    }

    const upload = c.env.BUCKET.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, c.req.raw.body);

    return c.json({
      part_number: part.partNumber,
      etag: part.etag,
    });
  })
  .post("/:uploadId/complete", async (c) => {
    const uploadId = c.req.param("uploadId");
    const body = await c.req.json<{
      key?: string;
      parts?: { part_number: number; etag: string }[];
    }>();

    if (!body.key || !body.parts || body.parts.length === 0) {
      throw new AppError(400, "BAD_REQUEST", "key and parts are required");
    }

    const upload = c.env.BUCKET.resumeMultipartUpload(body.key, uploadId);
    await upload.complete(
      body.parts.map((p) => ({
        partNumber: p.part_number,
        etag: p.etag,
      })),
    );

    return c.json({ key: body.key, status: "completed" });
  })
  .delete("/:uploadId", async (c) => {
    const uploadId = c.req.param("uploadId");
    const key = c.req.query("key");

    if (!key) {
      throw new AppError(400, "BAD_REQUEST", "key query parameter is required");
    }

    const upload = c.env.BUCKET.resumeMultipartUpload(key, uploadId);
    await upload.abort();

    return c.json({ status: "aborted" });
  });

export default uploads;
