import { decode } from "hono/jwt";

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

const decodePayload = (token: string): Record<string, unknown> | null => {
  try {
    const { payload } = decode(token);
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const isTokenExpired = (token: string): boolean => {
  const payload = decodePayload(token);
  if (!payload || typeof payload.exp !== "number") return true;
  return payload.exp < Date.now() / 1000;
};

export const parseUser = (token: string): AuthUser | null => {
  const payload = decodePayload(token);
  if (!payload || typeof payload.sub !== "string" || typeof payload.email !== "string") {
    return null;
  }
  return {
    id: payload.sub,
    email: payload.email,
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
  };
};
