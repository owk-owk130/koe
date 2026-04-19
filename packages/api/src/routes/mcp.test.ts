import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { onError } from "~/lib/errors";
import { createJob, createTopics } from "~/repositories/job-repository";
import { createUser } from "~/repositories/user-repository";
import { signToken } from "~/services/auth-service";
import { setupD1 } from "~/test-helpers";
import type { Env } from "~/types";
import mcp from "./mcp";

const TEST_SECRET = "test-jwt-secret";
const makeEnv = () => ({ ...env, JWT_SECRET: TEST_SECRET });

const app = new Hono<Env>();
app.onError(onError);
app.route("/mcp", mcp);

let userAToken: string;
let userBToken: string;

beforeAll(async () => {
  await setupD1();
  await createUser(env.DB, {
    id: "mcp-user-a",
    googleId: "g-mcp-a",
    email: "mcp-a@test.com",
    name: "MCP A",
  });
  await createUser(env.DB, {
    id: "mcp-user-b",
    googleId: "g-mcp-b",
    email: "mcp-b@test.com",
    name: "MCP B",
  });
  userAToken = await signToken({ sub: "mcp-user-a", email: "mcp-a@test.com" }, TEST_SECRET);
  userBToken = await signToken({ sub: "mcp-user-b", email: "mcp-b@test.com" }, TEST_SECRET);

  await createJob(env.DB, {
    id: "mcp-job-a1",
    userId: "mcp-user-a",
    audioKey: "mcp-user-a/audio/mcp-job-a1/original.mp3",
  });
  await createJob(env.DB, {
    id: "mcp-job-b1",
    userId: "mcp-user-b",
    audioKey: "mcp-user-b/audio/mcp-job-b1/original.mp3",
  });
  await createTopics(env.DB, "mcp-job-a1", [
    {
      id: "mcp-topic-a1-0",
      topicIndex: 0,
      title: "Kickoff meeting",
      summary: "planning the sprint",
      transcript: "...",
    },
    {
      id: "mcp-topic-a1-1",
      topicIndex: 1,
      title: "Random chatter",
      summary: "irrelevant",
      transcript: "...",
    },
  ]);
  await createTopics(env.DB, "mcp-job-b1", [
    {
      id: "mcp-topic-b1-0",
      topicIndex: 0,
      title: "Kickoff meeting of user B",
      summary: "should not leak",
      transcript: "...",
    },
  ]);
});

type JsonRpcResult = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
};

const parseSseResult = async (res: Response): Promise<JsonRpcResult> => {
  const text = await res.text();
  const dataLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("data:"));
  if (!dataLine) throw new Error(`no data line in SSE body: ${text}`);
  return JSON.parse(dataLine.slice("data:".length).trim()) as JsonRpcResult;
};

const callMcp = async (token: string | null, body: unknown): Promise<Response> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.request("/mcp", { method: "POST", headers, body: JSON.stringify(body) }, makeEnv());
};

const extractToolCallJson = (result: JsonRpcResult): unknown => {
  const content = (result.result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0].text);
};

describe("POST /mcp", () => {
  it("returns 401 without auth", async () => {
    const res = await callMcp(null, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(res.status).toBe(401);
  });

  it("lists all four tools on tools/list", async () => {
    const res = await callMcp(userAToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(res.status).toBe(200);
    const parsed = await parseSseResult(res);
    const tools = (parsed.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_job", "get_topics", "list_jobs", "search_topics"]);
  });

  describe("tools/call list_jobs", () => {
    it("returns only the caller's jobs", async () => {
      const res = await callMcp(userAToken, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_jobs", arguments: {} },
      });
      expect(res.status).toBe(200);
      const parsed = await parseSseResult(res);
      const payload = extractToolCallJson(parsed) as {
        jobs: Array<{ id: string }>;
      };
      expect(payload.jobs.some((j) => j.id === "mcp-job-a1")).toBe(true);
      expect(payload.jobs.every((j) => j.id !== "mcp-job-b1")).toBe(true);
    });
  });

  describe("tools/call get_job", () => {
    it("returns the job when owned by the caller", async () => {
      const res = await callMcp(userAToken, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_job", arguments: { job_id: "mcp-job-a1" } },
      });
      const parsed = await parseSseResult(res);
      const payload = extractToolCallJson(parsed) as { id: string };
      expect(payload.id).toBe("mcp-job-a1");
    });

    it("returns an error when the job belongs to another user", async () => {
      const res = await callMcp(userAToken, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_job", arguments: { job_id: "mcp-job-b1" } },
      });
      const parsed = await parseSseResult(res);
      const result = parsed.result as { isError?: boolean };
      expect(result.isError).toBe(true);
    });
  });

  describe("tools/call search_topics", () => {
    it("matches titles for the caller only", async () => {
      const res = await callMcp(userAToken, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_topics", arguments: { query: "Kickoff" } },
      });
      const parsed = await parseSseResult(res);
      const payload = extractToolCallJson(parsed) as {
        topics: Array<{ id: string; title: string }>;
      };
      expect(payload.topics.length).toBe(1);
      expect(payload.topics[0].id).toBe("mcp-topic-a1-0");
    });

    it("excludes topics from other users", async () => {
      const res = await callMcp(userBToken, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_topics", arguments: { query: "Kickoff" } },
      });
      const parsed = await parseSseResult(res);
      const payload = extractToolCallJson(parsed) as {
        topics: Array<{ id: string }>;
      };
      expect(payload.topics.every((t) => t.id !== "mcp-topic-a1-0")).toBe(true);
      expect(payload.topics.some((t) => t.id === "mcp-topic-b1-0")).toBe(true);
    });
  });
});
