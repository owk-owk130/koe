import { BYOK_HEADER } from "@koe/shared";
import type { AiSecrets } from "~/shared/ipc-channels";

// Maps locally stored BYOK material to the HTTP headers the API extracts in
// packages/api/src/routes/jobs-helpers.ts. The header name mapping lives in
// @koe/shared so both ends can't drift.
//
// Empty values are dropped so they don't reach the server as blank strings —
// the API treats blank as absent, but skipping the header entirely is cheaper
// and keeps the wire payload clean.
const SECRET_TO_HEADER: { secret: keyof AiSecrets; header: string }[] = [
  { secret: "geminiApiKey", header: BYOK_HEADER.geminiApiKey },
  { secret: "geminiModel", header: BYOK_HEADER.geminiModel },
  { secret: "cfApiToken", header: BYOK_HEADER.whisperApiKey },
  { secret: "cfAccountId", header: BYOK_HEADER.whisperAccountId },
];

export const buildSecretHeaders = (secrets: AiSecrets): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const { secret, header } of SECRET_TO_HEADER) {
    const value = secrets[secret];
    if (value) headers[header] = value;
  }
  return headers;
};

// Reads BYOK material via Electron IPC and returns the corresponding headers.
// Renderer-only helper. Returns an empty object if the IPC call fails so a
// broken secrets pipeline never blocks job creation.
export const fetchSecretHeaders = async (): Promise<Record<string, string>> => {
  try {
    const secrets = await window.electronAPI.getSecrets();
    return buildSecretHeaders(secrets);
  } catch {
    return {};
  }
};
