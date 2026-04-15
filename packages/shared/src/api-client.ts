import { hc, parseResponse } from "hono/client";
import type { AppType } from "@koe/api/app";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// カスタム fetch: エラー処理を一元化（428 はポーリング用に通す）
const errorHandlingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (!res.ok && res.status !== 428) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const err = body?.error;
    throw new ApiError(err?.code ?? "UNKNOWN", err?.message ?? "Unknown error", res.status);
  }
  return res;
};

type CreateClientOptions = {
  getToken?: () => string | null;
};

export function createClient(baseUrl: string, options: CreateClientOptions = {}) {
  return hc<AppType>(baseUrl, {
    fetch: errorHandlingFetch,
    headers: (): Record<string, string> => {
      const token = options.getToken?.();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  });
}

export { parseResponse };
