export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

export type Variables = {
  user?: { id: string; email: string; name?: string };
};

export type Env = { Bindings: Bindings; Variables: Variables };
