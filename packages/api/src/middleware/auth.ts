import type { MiddlewareHandler } from "hono";
import { findUserById } from "~/repositories/user-repository";
import { verifyToken } from "~/services/auth-service";
import type { Env } from "~/types";

const extractToken = (header: string | undefined): string | null => {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
};

export const requireAuth: () => MiddlewareHandler<Env> = () => async (c, next) => {
  const token = extractToken(c.req.header("Authorization"));
  if (!token) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Missing token" } }, 401);
  }

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    const user = await findUserById(c.env.DB, payload.sub);
    if (!user) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "User not found" } }, 401);
    }
    c.set("user", {
      id: user.id,
      email: user.email,
      name: user.name ?? undefined,
    });
  } catch {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } }, 401);
  }

  await next();
};

export const optionalAuth: () => MiddlewareHandler<Env> = () => async (c, next) => {
  const token = extractToken(c.req.header("Authorization"));
  if (!token) {
    await next();
    return;
  }

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    const user = await findUserById(c.env.DB, payload.sub);
    if (user) {
      c.set("user", {
        id: user.id,
        email: user.email,
        name: user.name ?? undefined,
      });
    }
  } catch {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } }, 401);
  }

  await next();
};
