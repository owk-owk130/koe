import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { setupD1 } from "~/test-helpers";
import { createChunks, findChunksByJob } from "./chunk-repository";
import {
  claimJobForAnalyze,
  claimJobForTranscribe,
  completeJob,
  createCompletedJob,
  createJob,
  createTopics,
  deleteJob,
  deleteTopicsByJob,
  findJobById,
  findTopicsByJob,
  listJobsByUser,
  markAsAnalyzeFailed,
  markAsTranscribed,
  markAsTranscribeFailed,
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
    await updateJobStatus(env.DB, "job-1", "transcribing");
    const job = await findJobById(env.DB, "job-1");
    expect(job!.status).toBe("transcribing");
  });

  it("updates job status with error", async () => {
    await updateJobStatus(env.DB, "job-2", "failed", "something went wrong");
    const job = await findJobById(env.DB, "job-2");
    expect(job!.status).toBe("failed");
    expect(job!.error).toBe("something went wrong");
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

  // D1 caps bound parameters at 100 per query. Each row binds 10 columns, so a
  // single-statement insert of >10 rows overflows the limit. The repository
  // must batch internally so callers can pass arbitrary lengths safely.
  it("creates a large number of topics in a single call", async () => {
    await createJob(env.DB, {
      id: "topics-large",
      userId: "u1",
      audioKey: "u1/audio/topics-large/original.mp3",
    });

    const inputs = Array.from({ length: 30 }, (_, i) => ({
      id: `large-topic-${i}`,
      topicIndex: i,
      title: `Topic ${i}`,
      summary: `Summary ${i}`,
      detail: `Detail ${i}`,
      startSec: i * 60,
      endSec: (i + 1) * 60,
      transcript: `Body ${i}`,
    }));

    await createTopics(env.DB, "topics-large", inputs);

    const topics = await findTopicsByJob(env.DB, "topics-large");
    expect(topics.length).toBe(30);
    expect(topics[0].title).toBe("Topic 0");
    expect(topics[29].title).toBe("Topic 29");
    expect(topics[29].transcript).toBe("Body 29");
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

  describe("deleteJob", () => {
    it("removes the job, its topics, and its chunks", async () => {
      await createJob(env.DB, {
        id: "del-job-1",
        userId: "u1",
        audioKey: "u1/audio/del-job-1/original.mp3",
      });
      await createTopics(env.DB, "del-job-1", [
        {
          id: "del-topic-1",
          topicIndex: 0,
          title: "to be removed",
          transcript: "body",
        },
      ]);
      await createChunks(env.DB, "del-job-1", [
        {
          id: "del-chunk-1",
          chunkIndex: 0,
          audioKey: "u1/audio/del-job-1/chunks/0.mp3",
          startSec: 0,
          endSec: 10,
        },
      ]);

      const deleted = await deleteJob(env.DB, "del-job-1", "u1");
      expect(deleted).toBe(true);

      expect(await findJobById(env.DB, "del-job-1")).toBeNull();
      expect(await findTopicsByJob(env.DB, "del-job-1")).toEqual([]);
      expect(await findChunksByJob(env.DB, "del-job-1")).toEqual([]);
    });

    it("does not delete a job owned by another user", async () => {
      await createJob(env.DB, {
        id: "del-job-other",
        userId: "u2",
        audioKey: "u2/audio/del-job-other/original.mp3",
      });

      const deleted = await deleteJob(env.DB, "del-job-other", "u1");
      expect(deleted).toBe(false);

      const still = await findJobById(env.DB, "del-job-other");
      expect(still).not.toBeNull();
    });

    it("returns false for a non-existent job", async () => {
      const deleted = await deleteJob(env.DB, "does-not-exist", "u1");
      expect(deleted).toBe(false);
    });
  });

  describe("claimJobForTranscribe", () => {
    it("transitions pending → transcribing and returns true", async () => {
      await createJob(env.DB, {
        id: "tx-claim-1",
        userId: "u1",
        audioKey: "u1/audio/tx-claim-1/original.mp3",
      });

      const claimed = await claimJobForTranscribe(env.DB, "tx-claim-1");
      expect(claimed).toBe(true);

      const job = await findJobById(env.DB, "tx-claim-1");
      expect(job!.status).toBe("transcribing");
    });

    it("also accepts transcribe_failed → transcribing for retries", async () => {
      await createJob(env.DB, {
        id: "tx-claim-retry",
        userId: "u1",
        audioKey: "u1/audio/tx-claim-retry/original.mp3",
      });
      await markAsTranscribeFailed(env.DB, "tx-claim-retry", "boom");

      const claimed = await claimJobForTranscribe(env.DB, "tx-claim-retry");
      expect(claimed).toBe(true);

      const job = await findJobById(env.DB, "tx-claim-retry");
      expect(job!.status).toBe("transcribing");
      // The error from the prior failure must be cleared on a fresh claim.
      expect(job!.error).toBeNull();
    });

    it("returns false when the job is not in a transcribe-eligible state", async () => {
      await createJob(env.DB, {
        id: "tx-claim-busy",
        userId: "u1",
        audioKey: "u1/audio/tx-claim-busy/original.mp3",
      });
      await updateJobStatus(env.DB, "tx-claim-busy", "completed");

      const claimed = await claimJobForTranscribe(env.DB, "tx-claim-busy");
      expect(claimed).toBe(false);
    });
  });

  describe("markAsTranscribed", () => {
    it("records transcript_key + totalChunks and moves status to transcribed", async () => {
      await createJob(env.DB, {
        id: "tx-mark-1",
        userId: "u1",
        audioKey: "u1/audio/tx-mark-1/original.mp3",
      });
      await claimJobForTranscribe(env.DB, "tx-mark-1");

      await markAsTranscribed(env.DB, "tx-mark-1", {
        transcriptKey: "u1/results/tx-mark-1/transcript.json",
        totalChunks: 7,
      });

      const job = await findJobById(env.DB, "tx-mark-1");
      expect(job!.status).toBe("transcribed");
      expect(job!.transcriptKey).toBe("u1/results/tx-mark-1/transcript.json");
      expect(job!.totalChunks).toBe(7);
      expect(job!.completedChunks).toBe(7);
    });
  });

  describe("markAsTranscribeFailed", () => {
    it("records the error and moves status to transcribe_failed", async () => {
      await createJob(env.DB, {
        id: "tx-fail-1",
        userId: "u1",
        audioKey: "u1/audio/tx-fail-1/original.mp3",
      });

      await markAsTranscribeFailed(env.DB, "tx-fail-1", "whisper boom");

      const job = await findJobById(env.DB, "tx-fail-1");
      expect(job!.status).toBe("transcribe_failed");
      expect(job!.error).toBe("whisper boom");
    });
  });

  describe("claimJobForAnalyze", () => {
    it("transitions transcribed → analyzing", async () => {
      await createJob(env.DB, {
        id: "an-claim-1",
        userId: "u1",
        audioKey: "u1/audio/an-claim-1/original.mp3",
      });
      await updateJobStatus(env.DB, "an-claim-1", "transcribed");

      const claimed = await claimJobForAnalyze(env.DB, "an-claim-1");
      expect(claimed).toBe(true);

      const job = await findJobById(env.DB, "an-claim-1");
      expect(job!.status).toBe("analyzing");
    });

    it("transitions analyze_failed → analyzing for retries", async () => {
      await createJob(env.DB, {
        id: "an-claim-retry",
        userId: "u1",
        audioKey: "u1/audio/an-claim-retry/original.mp3",
      });
      await updateJobStatus(env.DB, "an-claim-retry", "transcribed");
      await claimJobForAnalyze(env.DB, "an-claim-retry");
      await markAsAnalyzeFailed(env.DB, "an-claim-retry", "gemini parse failed");

      const claimed = await claimJobForAnalyze(env.DB, "an-claim-retry");
      expect(claimed).toBe(true);

      const job = await findJobById(env.DB, "an-claim-retry");
      expect(job!.status).toBe("analyzing");
      // Stale error must be cleared on a fresh claim.
      expect(job!.error).toBeNull();
    });

    it("returns false when the job has not finished transcribe yet", async () => {
      await createJob(env.DB, {
        id: "an-claim-too-early",
        userId: "u1",
        audioKey: "u1/audio/an-claim-too-early/original.mp3",
      });

      const claimed = await claimJobForAnalyze(env.DB, "an-claim-too-early");
      expect(claimed).toBe(false);
    });
  });

  describe("markAsAnalyzeFailed", () => {
    it("records the error and moves status to analyze_failed", async () => {
      await createJob(env.DB, {
        id: "an-fail-1",
        userId: "u1",
        audioKey: "u1/audio/an-fail-1/original.mp3",
      });
      await updateJobStatus(env.DB, "an-fail-1", "analyzing");

      await markAsAnalyzeFailed(env.DB, "an-fail-1", "gemini boom");

      const job = await findJobById(env.DB, "an-fail-1");
      expect(job!.status).toBe("analyze_failed");
      expect(job!.error).toBe("gemini boom");
    });
  });

  describe("claimJobForAnalyze (completed re-run)", () => {
    it("transitions completed → analyzing for regeneration", async () => {
      await createJob(env.DB, {
        id: "an-claim-completed",
        userId: "u1",
        audioKey: "u1/audio/an-claim-completed/original.mp3",
      });
      await updateJobStatus(env.DB, "an-claim-completed", "completed");

      const claimed = await claimJobForAnalyze(env.DB, "an-claim-completed");
      expect(claimed).toBe(true);

      const job = await findJobById(env.DB, "an-claim-completed");
      expect(job!.status).toBe("analyzing");
    });
  });

  describe("deleteTopicsByJob", () => {
    it("removes only the topics belonging to the given job", async () => {
      await createJob(env.DB, {
        id: "del-topics-target",
        userId: "u1",
        audioKey: "u1/audio/del-topics-target/original.mp3",
      });
      await createJob(env.DB, {
        id: "del-topics-other",
        userId: "u1",
        audioKey: "u1/audio/del-topics-other/original.mp3",
      });
      await createTopics(env.DB, "del-topics-target", [
        { id: "tt-1", topicIndex: 0, title: "A", transcript: "a" },
        { id: "tt-2", topicIndex: 1, title: "B", transcript: "b" },
      ]);
      await createTopics(env.DB, "del-topics-other", [
        { id: "to-1", topicIndex: 0, title: "C", transcript: "c" },
      ]);

      await deleteTopicsByJob(env.DB, "del-topics-target");

      expect((await findTopicsByJob(env.DB, "del-topics-target")).length).toBe(0);
      // Other job's topics must remain untouched.
      expect((await findTopicsByJob(env.DB, "del-topics-other")).length).toBe(1);
    });
  });
});
