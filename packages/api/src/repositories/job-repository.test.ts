import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { setupD1 } from "~/test-helpers";
import {
  claimJobForProcessing,
  completeJob,
  createCompletedJob,
  createJob,
  createTopics,
  findJobById,
  findTopicsByJob,
  listJobsByUser,
  searchTopicsByUser,
  updateJobStatus,
} from "./job-repository";

beforeAll(async () => {
  await setupD1();
  // seed user
  await env.DB.prepare("INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)")
    .bind("u1", "g1", "user@test.com", "User")
    .run();
});

describe("job-repository", () => {
  it("creates a job", async () => {
    const job = await createJob(env.DB, {
      id: "job-1",
      userId: "u1",
      audioKey: "u1/audio/job-1/original.mp3",
    });

    expect(job.id).toBe("job-1");
    expect(job.status).toBe("pending");
    expect(job.userId).toBe("u1");
  });

  it("finds a job by id", async () => {
    const job = await findJobById(env.DB, "job-1");
    expect(job).not.toBeNull();
    expect(job!.audioKey).toBe("u1/audio/job-1/original.mp3");
  });

  it("returns null for non-existent job", async () => {
    const job = await findJobById(env.DB, "nonexistent");
    expect(job).toBeNull();
  });

  it("lists jobs by user", async () => {
    await createJob(env.DB, {
      id: "job-2",
      userId: "u1",
      audioKey: "u1/audio/job-2/original.mp3",
    });

    const jobs = await listJobsByUser(env.DB, "u1");
    expect(jobs.length).toBe(2);
  });

  it("lists jobs with limit and offset", async () => {
    const jobs = await listJobsByUser(env.DB, "u1", { limit: 1, offset: 0 });
    expect(jobs.length).toBe(1);
  });

  it("updates job status", async () => {
    await updateJobStatus(env.DB, "job-1", "splitting");
    const job = await findJobById(env.DB, "job-1");
    expect(job!.status).toBe("splitting");
  });

  it("updates job status with error", async () => {
    await updateJobStatus(env.DB, "job-2", "failed", "something went wrong");
    const job = await findJobById(env.DB, "job-2");
    expect(job!.status).toBe("failed");
    expect(job!.error).toBe("something went wrong");
  });

  describe("claimJobForProcessing", () => {
    it("transitions pending → processing and returns true", async () => {
      await createJob(env.DB, {
        id: "claim-pending",
        userId: "u1",
        audioKey: "u1/audio/claim-pending/original.mp3",
      });

      const claimed = await claimJobForProcessing(env.DB, "claim-pending");
      expect(claimed).toBe(true);

      const job = await findJobById(env.DB, "claim-pending");
      expect(job!.status).toBe("processing");
    });

    it("returns false when the job is not pending", async () => {
      await createJob(env.DB, {
        id: "claim-nonpending",
        userId: "u1",
        audioKey: "u1/audio/claim-nonpending/original.mp3",
      });
      await updateJobStatus(env.DB, "claim-nonpending", "processing");

      const claimed = await claimJobForProcessing(env.DB, "claim-nonpending");
      expect(claimed).toBe(false);
    });

    it("returns false when the job does not exist", async () => {
      const claimed = await claimJobForProcessing(env.DB, "does-not-exist");
      expect(claimed).toBe(false);
    });
  });

  describe("completeJob", () => {
    it("sets status completed with summary and chunk counts", async () => {
      await createJob(env.DB, {
        id: "complete-1",
        userId: "u1",
        audioKey: "u1/audio/complete-1/original.mp3",
      });

      await completeJob(env.DB, "complete-1", {
        summary: "final summary",
        totalChunks: 3,
        completedChunks: 3,
      });

      const job = await findJobById(env.DB, "complete-1");
      expect(job!.status).toBe("completed");
      expect(job!.summary).toBe("final summary");
      expect(job!.totalChunks).toBe(3);
      expect(job!.completedChunks).toBe(3);
    });
  });

  describe("createCompletedJob", () => {
    it("inserts a job in completed status with local- prefixed audioKey", async () => {
      const job = await createCompletedJob(env.DB, {
        id: "local-1",
        userId: "u1",
        audioFilename: "meeting.mp3",
        summary: "pre-computed summary",
      });

      expect(job.id).toBe("local-1");
      expect(job.status).toBe("completed");
      expect(job.summary).toBe("pre-computed summary");
      expect(job.audioKey).toBe("u1/audio/local-1/local-meeting.mp3");
    });

    it("allows null summary", async () => {
      const job = await createCompletedJob(env.DB, {
        id: "local-2",
        userId: "u1",
        audioFilename: "no-summary.wav",
        summary: null,
      });

      expect(job.status).toBe("completed");
      expect(job.summary).toBeNull();
      expect(job.audioKey).toBe("u1/audio/local-2/local-no-summary.wav");
    });

    it("is discoverable via listJobsByUser alongside regular jobs", async () => {
      await createCompletedJob(env.DB, {
        id: "local-3",
        userId: "u1",
        audioFilename: "a.mp3",
        summary: null,
      });

      const found = await findJobById(env.DB, "local-3");
      expect(found).not.toBeNull();
      expect(found!.userId).toBe("u1");
    });
  });

  it("creates and finds topics", async () => {
    await createTopics(env.DB, "job-1", [
      {
        id: "topic-1",
        topicIndex: 0,
        title: "Introduction",
        summary: "Opening remarks",
        startSec: 0,
        endSec: 60,
        transcript: "Hello everyone...",
      },
      {
        id: "topic-2",
        topicIndex: 1,
        title: "Main Discussion",
        summary: "Core topic",
        startSec: 60,
        endSec: 300,
        transcript: "Let us discuss...",
      },
    ]);

    const topics = await findTopicsByJob(env.DB, "job-1");
    expect(topics.length).toBe(2);
    expect(topics[0].title).toBe("Introduction");
    expect(topics[1].title).toBe("Main Discussion");
  });

  describe("searchTopicsByUser", () => {
    beforeAll(async () => {
      // second user with their own job+topic to verify isolation
      await env.DB.prepare("INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)")
        .bind("u2", "g2", "other@test.com", "Other")
        .run();
      await createJob(env.DB, {
        id: "search-job-u1",
        userId: "u1",
        audioKey: "u1/audio/search-job-u1/original.mp3",
      });
      await createJob(env.DB, {
        id: "search-job-u2",
        userId: "u2",
        audioKey: "u2/audio/search-job-u2/original.mp3",
      });
      await createTopics(env.DB, "search-job-u1", [
        {
          id: "search-topic-1",
          topicIndex: 0,
          title: "React performance tuning",
          summary: "Covers memoization and profiling",
          transcript: "body 1",
        },
        {
          id: "search-topic-2",
          topicIndex: 1,
          title: "Database migrations",
          summary: "About Drizzle and D1",
          transcript: "body 2",
        },
        {
          id: "search-topic-3",
          topicIndex: 2,
          title: "Weekly standup",
          summary: "General updates",
          transcript: "body 3",
        },
      ]);
      await createTopics(env.DB, "search-job-u2", [
        {
          id: "search-topic-other",
          topicIndex: 0,
          title: "React hooks deep dive",
          summary: "Something about React",
          transcript: "body other",
        },
      ]);
      await createTopics(env.DB, "search-job-u1", [
        {
          id: "search-topic-pct",
          topicIndex: 3,
          title: "Battery 100% milestone",
          summary: "plain text",
          transcript: "body pct",
        },
        {
          id: "search-topic-underscore",
          topicIndex: 4,
          title: "plain title",
          summary: "snake_case convention",
          transcript: "body us",
        },
      ]);
    });

    it("matches on title", async () => {
      const results = await searchTopicsByUser(env.DB, "u1", { query: "React" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("search-topic-1");
      expect(results[0].jobId).toBe("search-job-u1");
    });

    it("matches on summary", async () => {
      const results = await searchTopicsByUser(env.DB, "u1", { query: "Drizzle" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("search-topic-2");
    });

    it("does not return topics owned by other users", async () => {
      const results = await searchTopicsByUser(env.DB, "u1", { query: "React" });
      expect(results.every((t) => t.id !== "search-topic-other")).toBe(true);
    });

    it("honors limit", async () => {
      const results = await searchTopicsByUser(env.DB, "u1", { query: "e", limit: 1 });
      expect(results.length).toBe(1);
    });

    it("treats '%' in the query as a literal, not a wildcard", async () => {
      const results = await searchTopicsByUser(env.DB, "u1", { query: "100%" });
      const ids = results.map((t) => t.id);
      expect(ids).toContain("search-topic-pct");
      // '%' must not expand to match other titles that lack a literal '%'
      expect(ids).not.toContain("search-topic-1");
      expect(ids).not.toContain("search-topic-2");
      expect(ids).not.toContain("search-topic-3");
    });

    it("treats '_' in the query as a literal, not a single-char wildcard", async () => {
      const results = await searchTopicsByUser(env.DB, "u1", { query: "snake_case" });
      const ids = results.map((t) => t.id);
      expect(ids).toContain("search-topic-underscore");
      // '_' must not match arbitrary single chars in unrelated rows
      expect(ids.length).toBe(1);
    });

    it("returns empty when nothing matches", async () => {
      const results = await searchTopicsByUser(env.DB, "u1", {
        query: "zzz-no-match-here",
      });
      expect(results).toEqual([]);
    });
  });
});
