import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createApiClient,
  type DeviceCodeResponse,
  type TokenResponse,
  type JobListResponse,
  type JobDetailResponse,
  type TopicsResponse,
  type CreateJobResponse,
  type TranscribeResponse,
  type InitiateUploadResponse,
  type UploadPartResponse,
} from "./api-client";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("api-client", () => {
  const api = createApiClient("https://api.example.com");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getDeviceCode", () => {
    it("calls GET /auth/device and returns device code", async () => {
      const body: DeviceCodeResponse = {
        device_code: "dc-123",
        user_code: "ABCD-1234",
        verification_url: "https://example.com/activate",
        expires_in: 300,
        interval: 5,
      };
      vi.stubGlobal("fetch", mockFetch(200, body));

      const result = await api.getDeviceCode();
      expect(result).toEqual(body);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/auth/device",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("pollToken", () => {
    it("returns token response on 200", async () => {
      const body: TokenResponse = {
        token: "jwt-token",
        user: { id: "u1", email: "test@example.com", name: "Test" },
      };
      vi.stubGlobal("fetch", mockFetch(200, body));

      const result = await api.pollToken("dc-123");
      expect(result).toEqual(body);
    });

    it("returns null on 428 (pending)", async () => {
      vi.stubGlobal("fetch", mockFetch(428, { status: "pending" }));

      const result = await api.pollToken("dc-123");
      expect(result).toBeNull();
    });

    it("throws ApiError on 410 (expired)", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch(410, { error: { code: "EXPIRED", message: "Device code expired" } }),
      );

      await expect(api.pollToken("dc-123")).rejects.toThrow(ApiError);
    });
  });

  describe("listJobs", () => {
    it("calls GET /api/v1/jobs with auth header and query params", async () => {
      const body: JobListResponse = {
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

      const result = await api.listJobs("my-token", { limit: 10, offset: 0 });
      expect(result).toEqual(body);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/jobs?limit=10&offset=0",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer my-token" }),
        }),
      );
    });
  });

  describe("getJob", () => {
    it("calls GET /api/v1/jobs/:id", async () => {
      const body: JobDetailResponse = {
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

      const result = await api.getJob("my-token", "j1");
      expect(result).toEqual(body);
    });
  });

  describe("getTopics", () => {
    it("calls GET /api/v1/jobs/:id/topics", async () => {
      const body: TopicsResponse = {
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

      const result = await api.getTopics("my-token", "j1");
      expect(result).toEqual(body);
    });
  });

  describe("createJob", () => {
    it("calls POST /api/v1/jobs with FormData", async () => {
      const body: CreateJobResponse = {
        id: "j-new",
        status: "pending",
        audio_key: "key",
        created_at: "2025-01-01T00:00:00Z",
      };
      vi.stubGlobal("fetch", mockFetch(201, body));

      const file = new File(["audio"], "test.mp3", { type: "audio/mpeg" });
      const result = await api.createJob("my-token", file);
      expect(result).toEqual(body);

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[1]?.method).toBe("POST");
      expect(call[1]?.body).toBeInstanceOf(FormData);
    });
  });

  describe("transcribe", () => {
    it("calls POST /api/v1/transcribe with FormData", async () => {
      const body: TranscribeResponse = {
        transcript: { text: "hello", segments: [{ text: "hello", start_sec: 0, end_sec: 1 }] },
        topics: [
          {
            index: 0,
            title: "Greeting",
            summary: "A greeting",
            start_sec: 0,
            end_sec: 1,
            transcript: "hello",
          },
        ],
      };
      vi.stubGlobal("fetch", mockFetch(200, body));

      const file = new File(["audio"], "test.mp3", { type: "audio/mpeg" });
      const result = await api.transcribe(file);
      expect(result).toEqual(body);
    });
  });

  describe("upload endpoints", () => {
    it("initiateUpload calls POST /api/v1/uploads", async () => {
      const body: InitiateUploadResponse = {
        upload_id: "up-1",
        key: "user/audio/j1/original.mp3",
        job_id: "j1",
      };
      vi.stubGlobal("fetch", mockFetch(200, body));

      const result = await api.initiateUpload("my-token", "test.mp3");
      expect(result).toEqual(body);
    });

    it("uploadPart calls PUT /api/v1/uploads/:id/parts/:num", async () => {
      const body: UploadPartResponse = { part_number: 1, etag: "etag-1" };
      vi.stubGlobal("fetch", mockFetch(200, body));

      const chunk = new Blob(["data"]);
      const result = await api.uploadPart("my-token", "up-1", 1, "key", chunk);
      expect(result).toEqual(body);
    });

    it("completeUpload calls POST /api/v1/uploads/:id/complete", async () => {
      vi.stubGlobal("fetch", mockFetch(200, { key: "k", status: "completed" }));

      const result = await api.completeUpload("my-token", "up-1", "key", [
        { part_number: 1, etag: "e1" },
      ]);
      expect(result).toEqual({ key: "k", status: "completed" });
    });

    it("abortUpload calls DELETE /api/v1/uploads/:id", async () => {
      vi.stubGlobal("fetch", mockFetch(200, { status: "aborted" }));

      const result = await api.abortUpload("my-token", "up-1", "key");
      expect(result).toEqual({ status: "aborted" });
    });
  });

  describe("error handling", () => {
    it("throws ApiError with code and message for non-ok responses", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch(401, { error: { code: "UNAUTHORIZED", message: "Invalid token" } }),
      );

      try {
        await api.listJobs("bad-token");
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
