// Pulls user-provided BYOK material out of the incoming request headers so
// the route can hand it to the DurableObject via the JobPayload. Header names
// match the desktop client (see packages/desktop/src/renderer/hooks/useJobs.ts).
//
// Empty / whitespace-only headers are treated as absent so the DO falls back
// to env defaults rather than overriding with a blank string (which would
// otherwise hit the API as a malformed key).
export type AiKeyOverrides = {
  geminiApiKey?: string;
  geminiModel?: string;
  whisperApiKey?: string;
  whisperAccountId?: string;
};

const HEADER_FIELD: { header: string; key: keyof AiKeyOverrides }[] = [
  { header: "X-Gemini-Key", key: "geminiApiKey" },
  { header: "X-Gemini-Model", key: "geminiModel" },
  { header: "X-Cf-Token", key: "whisperApiKey" },
  { header: "X-Cf-Account-Id", key: "whisperAccountId" },
];

export const extractAiKeysFromHeaders = (headers: Headers): AiKeyOverrides => {
  const out: AiKeyOverrides = {};
  for (const { header, key } of HEADER_FIELD) {
    const raw = headers.get(header);
    if (!raw) continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    out[key] = trimmed;
  }
  return out;
};
