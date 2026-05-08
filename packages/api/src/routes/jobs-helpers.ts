import { BYOK_HEADER, type ByokField } from "@koe/shared";

// Pulls user-provided BYOK material out of the incoming request headers so
// the route can hand it to the DurableObject via the JobPayload. The header
// name mapping is shared with the desktop client via @koe/shared.
//
// Empty / whitespace-only headers are treated as absent so the DO falls back
// to env defaults rather than overriding with a blank string (which would
// otherwise hit the API as a malformed key).
export type AiKeyOverrides = Partial<Record<ByokField, string>>;

export const extractAiKeysFromHeaders = (headers: Headers): AiKeyOverrides => {
  const out: AiKeyOverrides = {};
  for (const field of Object.keys(BYOK_HEADER) as ByokField[]) {
    const raw = headers.get(BYOK_HEADER[field]);
    if (!raw) continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    out[field] = trimmed;
  }
  return out;
};
