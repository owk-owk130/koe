import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createClient, parseResponse } from "./api-client";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/** hc は Request オブジェクトか URL 文字列で fetch を呼ぶ。最初の引数から URL を取得 */
function getCalledUrl(mock: ReturnType<typeof vi.fn>): string {
  const arg = mock.mock.calls[0]?.[0];
  if (typeof arg === "string") return arg;
  if (arg instanceof URL) return arg.toString();
  if (arg instanceof Request) return arg.url;
  return String(arg);
}

describe("api-client", () => {
  const client = createClient("https://api.example.com");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth endpoints", () => {
    it("GET /auth/device returns device code", async () => {
      const body = {
        device_code: "dc-123",
        user_code: "ABCD-1234",
        verification_url: "https://example.com/activate",
        expires_in: 300,
        interval: 5,
      };
      vi.stubGlobal("fetch", mockFetch(200, body));

      const result = await parseResponse(client.auth.device.$get());
      expect(result).toEqual(body);
    });

    it("POST /auth/token returns null-like on 428", async () => {
      vi.stubGlobal("fetch", mockFetch(428, { status: "pending" }));

      const res = await client.auth.token.$post({
        json: { device_code: "dc-123" },
      });
      expect(res.status).toBe(428);
    });

    it("POST /auth/token throws on 410", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch(410, { error: { code: "EXPIRED", message: "Device code expired" } }),
      );

      await expect(
        client.auth.token.$post({ json: { device_code: "dc-123" } }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe("jobs endpoints", () => {
    it("GET /api/v1/jobs returns job list", async () => {
      const body = {
        jobs: [
          {
            id: "j1",
            status: "completed",
            audio_key: "key",
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
      };
      vi.stubGlobal("fetch", mockFetch(200, body));

      const authedClient = createClient("https://api.example.com", {
        getToken: () => "my-token",
      });
      const result = await parseResponse(authedClient.api.v1.jobs.$get());
      expect(result).toEqual(body);

      const url = getCalledUrl(vi.mocked(fetch));
      expect(url).toContain("/api/v1/jobs");
    });

    it("GET /api/v1/jobs/:id returns job detail", async () => {
      const body = {
        id: "j1",
        status: "completed",
        audio_key: "key",
        audio_duration_sec: 120,
        total_chunks: 4,
        completed_chunks: 4,
        error: null,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };
      vi.stubGlobal("fetch", mockFetch(200, body));

      const authedClient = createClient("https://api.example.com", {
        getToken: () => "my-token",
      });
      const result = await parseResponse(
        authedClient.api.v1.jobs[":id"].$get({ param: { id: "j1" } }),
      );
      expect(result).toEqual(body);

      const url = getCalledUrl(vi.mocked(fetch));
      expect(url).toContain("/api/v1/jobs/j1");
    });

    it("GET /api/v1/jobs/:id/topics returns topics", async () => {
      const body = {
        topics: [
          {
            id: "t1",
            topic_index: 0,
            title: "Topic 1",
            summary: "Summary",
            start_sec: 0,
            end_sec: 60,
            transcript: "Hello world",
          },
        ],
      };
      vi.stubGlobal("fetch", mockFetch(200, body));

      const authedClient = createClient("https://api.example.com", {
        getToken: () => "my-token",
      });
      const result = await parseResponse(
        authedClient.api.v1.jobs[":id"].topics.$get({ param: { id: "j1" } }),
      );
      expect(result).toEqual(body);
    });
  });

  describe("error handling", () => {
    it("throws ApiError for non-ok responses", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch(401, { error: { code: "UNAUTHORIZED", message: "Invalid token" } }),
      );

      try {
        await parseResponse(client.api.v1.jobs.$get());
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const err = e as ApiError;
        expect(err.code).toBe("UNAUTHORIZED");
        expect(err.message).toBe("Invalid token");
        expect(err.status).toBe(401);
      }
    });
  });
});
