const TOKEN_KEY = "koe_token";

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1]));
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodePayload(token);
  if (!payload || typeof payload.exp !== "number") return true;
  return payload.exp < Date.now() / 1000;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
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
