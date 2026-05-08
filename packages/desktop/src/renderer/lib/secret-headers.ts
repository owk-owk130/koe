import type { AiSecrets } from "~/shared/ipc-channels";

// Maps locally stored BYOK material to the HTTP headers the API extracts in
// packages/api/src/routes/jobs-helpers.ts. Keep both sides in sync.
//
// Empty values are dropped so they don't reach the server as blank strings —
// the API treats blank as absent, but skipping the header entirely is cheaper
// and keeps the wire payload clean.
export const buildSecretHeaders = (secrets: AiSecrets): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (secrets.geminiApiKey) headers["X-Gemini-Key"] = secrets.geminiApiKey;
  if (secrets.geminiModel) headers["X-Gemini-Model"] = secrets.geminiModel;
  if (secrets.cfApiToken) headers["X-Cf-Token"] = secrets.cfApiToken;
  if (secrets.cfAccountId) headers["X-Cf-Account-Id"] = secrets.cfAccountId;
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
