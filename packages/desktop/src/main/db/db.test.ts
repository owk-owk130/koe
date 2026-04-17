import { describe, expect, it } from "vitest";
import { createDatabase, LOCAL_USER_ID } from "./index";
import { jobs, syncState } from "./schema";

describe("desktop db", () => {
  it("opens an in-memory database with migrations applied", () => {
    const { db, close } = createDatabase(":memory:");

    const rows = db.select().from(jobs).all();
    expect(rows).toEqual([]);

    const syncRows = db.select().from(syncState).all();
    expect(syncRows).toEqual([]);

    close();
  });

  it("seeds the local sentinel user", () => {
    const { db, close } = createDatabase(":memory:");

    const rawUsers = db.$client.prepare("SELECT id, email FROM users").all() as Array<{
      id: string;
      email: string;
    }>;
    const local = rawUsers.find((u) => u.id === LOCAL_USER_ID);
    expect(local).toBeDefined();
    expect(local!.email).toBe("local@desktop");

    close();
  });

  it("enables foreign key constraints", () => {
    const { db, close } = createDatabase(":memory:");

    expect(() =>
      db.$client
        .prepare("INSERT INTO jobs (id, user_id, audio_key) VALUES (?, ?, ?)")
        .run("j-orphan", "nonexistent-user", "key"),
    ).toThrow(/FOREIGN KEY/i);

    close();
  });
});
