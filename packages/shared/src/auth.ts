export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodePayload(token);
  if (!payload || typeof payload.exp !== "number") return true;
  return payload.exp < Date.now() / 1000;
}

export function parseUser(token: string): AuthUser | null {
  const payload = decodePayload(token);
  if (!payload || typeof payload.sub !== "string" || typeof payload.email !== "string") {
    return null;
  }
  return {
    id: payload.sub,
    email: payload.email,
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
  };
}
