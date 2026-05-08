// Single source of truth for the BYOK header names that travel from the
// desktop app to the Workers API. Both ends import this so the mapping
// can't drift silently.

export const BYOK_HEADER = {
  geminiApiKey: "X-Gemini-Key",
  geminiModel: "X-Gemini-Model",
  whisperApiKey: "X-Cf-Token",
  whisperAccountId: "X-Cf-Account-Id",
} as const;

export type ByokField = keyof typeof BYOK_HEADER;
