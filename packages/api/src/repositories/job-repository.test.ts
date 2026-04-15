import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { setupD1 } from "~/test-helpers";
import {
  createJob,
  createTopics,
  findJobById,
  findTopicsByJob,
  listJobsByUser,
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
});
