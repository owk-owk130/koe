export type User = {
  id: string;
  googleId: string;
  email: string;
  name: string | null;
  createdAt: string;
};

type UserRow = {
  id: string;
  google_id: string;
  email: string;
  name: string | null;
  created_at: string;
};

const toUser = (row: UserRow): User => ({
  id: row.id,
  googleId: row.google_id,
  email: row.email,
  name: row.name,
  createdAt: row.created_at,
});

export const createUser = async (
  db: D1Database,
  input: { id: string; googleId: string; email: string; name?: string },
): Promise<User> => {
  await db
    .prepare("INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)")
    .bind(input.id, input.googleId, input.email, input.name ?? null)
    .run();

  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(input.id).first<UserRow>();
  return toUser(row!);
};

export const findUserByGoogleId = async (
  db: D1Database,
  googleId: string,
): Promise<User | null> => {
  const row = await db
    .prepare("SELECT * FROM users WHERE google_id = ?")
    .bind(googleId)
    .first<UserRow>();
  return row ? toUser(row) : null;
};

export const findUserById = async (db: D1Database, id: string): Promise<User | null> => {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return row ? toUser(row) : null;
};
