import { users } from "@koe/shared/db";
import { eq } from "drizzle-orm";
import { getDb } from "~/lib/db";

export type User = typeof users.$inferSelect;

export const createUser = async (
  d1: D1Database,
  input: { id: string; googleId: string; email: string; name?: string },
): Promise<User> => {
  const db = getDb(d1);
  const [row] = await db
    .insert(users)
    .values({
      id: input.id,
      googleId: input.googleId,
      email: input.email,
      name: input.name ?? null,
    })
    .returning();
  return row;
};

export const findUserByGoogleId = async (
  d1: D1Database,
  googleId: string,
): Promise<User | null> => {
  const db = getDb(d1);
  const [row] = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
  return row ?? null;
};

export const findUserById = async (d1: D1Database, id: string): Promise<User | null> => {
  const db = getDb(d1);
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
};
