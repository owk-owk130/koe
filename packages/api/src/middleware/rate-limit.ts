import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";

type RateLimitOptions = {
  max: number;
  windowMs: number;
};

type Entry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, Entry>();

const getKey = (ip: string | undefined): string => ip ?? "unknown";

export const rateLimit = (opts: RateLimitOptions): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const key = getKey(c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For"));
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, entry);

      // Purge expired entries to prevent unbounded growth
      for (const [k, v] of store) {
        if (now >= v.resetAt && k !== key) store.delete(k);
      }
    }

    entry.count++;

    if (entry.count > opts.max) {
      return c.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
    }

    await next();
  };
};
