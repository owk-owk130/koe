import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { setupD1 } from "../test-helpers";
import { createUser, findUserByGoogleId, findUserById } from "./user-repository";

beforeAll(async () => {
  await setupD1();
});

describe("user-repository", () => {
  it("creates and finds a user by google_id", async () => {
    const user = await createUser(env.DB, {
      id: "user-1",
      googleId: "google-123",
      email: "test@example.com",
      name: "Test User",
    });

    expect(user.id).toBe("user-1");
    expect(user.email).toBe("test@example.com");

    const found = await findUserByGoogleId(env.DB, "google-123");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("user-1");
    expect(found!.name).toBe("Test User");
  });

  it("finds a user by id", async () => {
    const found = await findUserById(env.DB, "user-1");
    expect(found).not.toBeNull();
    expect(found!.email).toBe("test@example.com");
  });

  it("returns null for non-existent google_id", async () => {
    const found = await findUserByGoogleId(env.DB, "nonexistent");
    expect(found).toBeNull();
  });

  it("returns null for non-existent id", async () => {
    const found = await findUserById(env.DB, "nonexistent");
    expect(found).toBeNull();
  });
});
