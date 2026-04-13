export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  PROCESSOR: DurableObjectNamespace;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  WHISPER_BASE_URL: string;
  WHISPER_API_KEY: string;
  WHISPER_MODEL: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
};

export type Variables = {
  user?: { id: string; email: string; name?: string };
};

export type Env = { Bindings: Bindings; Variables: Variables };
