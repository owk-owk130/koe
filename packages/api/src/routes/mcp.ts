import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "~/lib/errors";
import { requireAuth } from "~/middleware/auth";
import {
  findJobById,
  findTopicsByJob,
  listJobsByUser,
  searchTopicsByUser,
} from "~/repositories/job-repository";
import type { Env } from "~/types";

const textResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload) }],
});

const errorResult = (message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  isError: true,
});

const mcp = new Hono<Env>().use("/*", requireAuth()).all("/", async (c) => {
  const user = c.get("user");
  if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

  const server = new McpServer({ name: "koe", version: "0.1.0" });

  server.registerTool(
    "list_jobs",
    {
      description: "List the authenticated user's jobs ordered by createdAt desc.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ limit, offset }) => {
      const rows = await listJobsByUser(c.env.DB, user.id, { limit, offset });
      return textResult({
        jobs: rows.map((j) => ({
          id: j.id,
          status: j.status,
          audio_key: j.audioKey,
          created_at: j.createdAt,
          updated_at: j.updatedAt,
        })),
      });
    },
  );

  server.registerTool(
    "get_job",
    {
      description: "Fetch a job owned by the authenticated user by id.",
      inputSchema: {
        job_id: z.string().min(1),
      },
    },
    async ({ job_id }) => {
      const job = await findJobById(c.env.DB, job_id);
      if (!job || job.userId !== user.id) return errorResult("Job not found");
      return textResult({
        id: job.id,
        status: job.status,
        audio_key: job.audioKey,
        audio_duration_sec: job.audioDurationSec,
        total_chunks: job.totalChunks,
        completed_chunks: job.completedChunks,
        error: job.error,
        summary: job.summary,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
      });
    },
  );

  server.registerTool(
    "get_topics",
    {
      description: "List topics for a job owned by the authenticated user.",
      inputSchema: {
        job_id: z.string().min(1),
      },
    },
    async ({ job_id }) => {
      const job = await findJobById(c.env.DB, job_id);
      if (!job || job.userId !== user.id) return errorResult("Job not found");
      const rows = await findTopicsByJob(c.env.DB, job.id);
      return textResult({
        topics: rows.map((t) => ({
          id: t.id,
          topic_index: t.topicIndex,
          title: t.title,
          summary: t.summary,
          detail: t.detail,
          start_sec: t.startSec,
          end_sec: t.endSec,
          transcript: t.transcript,
        })),
      });
    },
  );

  server.registerTool(
    "search_topics",
    {
      description:
        "Search topics owned by the authenticated user whose title or summary contains the query.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) => {
      const rows = await searchTopicsByUser(c.env.DB, user.id, { query, limit });
      return textResult({
        topics: rows.map((t) => ({
          id: t.id,
          job_id: t.jobId,
          title: t.title,
          summary: t.summary,
          start_sec: t.startSec,
          end_sec: t.endSec,
          created_at: t.createdAt,
        })),
      });
    },
  );

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

export default mcp;
