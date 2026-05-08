import { describe, expect, it } from "vitest";
import { resolveGeminiOpts, resolveWhisperOpts } from "./processor";
import type { JobPayload } from "./processor";
import type { Bindings } from "./types";

const baseJob: JobPayload = {
  jobId: "job-1",
  userId: "user-1",
  audioKey: "user-1/audio/job-1/original.webm",
};

const baseEnv: Pick<
  Bindings,
  "WHISPER_BASE_URL" | "WHISPER_API_KEY" | "WHISPER_MODEL" | "GEMINI_API_KEY" | "GEMINI_MODEL"
> = {
  WHISPER_BASE_URL: "https://gateway.example/run",
  WHISPER_API_KEY: "env-whisper-key",
  WHISPER_MODEL: "@cf/openai/whisper-large-v3-turbo",
  GEMINI_API_KEY: "env-gemini-key",
  GEMINI_MODEL: "gemini-2.5-flash",
};

describe("resolveWhisperOpts", () => {
  it("uses env values when payload has no override", () => {
    const opts = resolveWhisperOpts(baseEnv as Bindings, baseJob);
    expect(opts).toEqual({
      baseURL: "https://gateway.example/run",
      apiKey: "env-whisper-key",
      model: "@cf/openai/whisper-large-v3-turbo",
    });
  });

  it("uses payload key + account id to build CF REST baseURL", () => {
    const opts = resolveWhisperOpts(baseEnv as Bindings, {
      ...baseJob,
      whisperApiKey: "user-cf-token",
      whisperAccountId: "abc123",
    });
    expect(opts).toEqual({
      baseURL: "https://api.cloudflare.com/client/v4/accounts/abc123/ai",
      apiKey: "user-cf-token",
      model: "@cf/openai/whisper-large-v3-turbo",
    });
  });

  it("falls back to env when only one of token/account id is provided", () => {
    const onlyToken = resolveWhisperOpts(baseEnv as Bindings, {
      ...baseJob,
      whisperApiKey: "user-cf-token",
    });
    expect(onlyToken.baseURL).toBe(baseEnv.WHISPER_BASE_URL);
    expect(onlyToken.apiKey).toBe(baseEnv.WHISPER_API_KEY);

    const onlyAccount = resolveWhisperOpts(baseEnv as Bindings, {
      ...baseJob,
      whisperAccountId: "abc123",
    });
    expect(onlyAccount.baseURL).toBe(baseEnv.WHISPER_BASE_URL);
    expect(onlyAccount.apiKey).toBe(baseEnv.WHISPER_API_KEY);
  });

  it("uses default model when env WHISPER_MODEL is empty", () => {
    const env = { ...baseEnv, WHISPER_MODEL: "" };
    const opts = resolveWhisperOpts(env as Bindings, baseJob);
    expect(opts.model).toBe("@cf/openai/whisper-large-v3-turbo");
  });
});

describe("resolveGeminiOpts", () => {
  it("uses env values when payload has no override", () => {
    const opts = resolveGeminiOpts(baseEnv as Bindings, baseJob);
    expect(opts).toEqual({
      apiKey: "env-gemini-key",
      model: "gemini-2.5-flash",
    });
  });

  it("prefers payload api key over env", () => {
    const opts = resolveGeminiOpts(baseEnv as Bindings, {
      ...baseJob,
      geminiApiKey: "user-gemini-key",
    });
    expect(opts.apiKey).toBe("user-gemini-key");
    expect(opts.model).toBe("gemini-2.5-flash");
  });

  it("prefers payload model over env", () => {
    const opts = resolveGeminiOpts(baseEnv as Bindings, {
      ...baseJob,
      geminiModel: "gemini-2.5-pro",
    });
    expect(opts.apiKey).toBe("env-gemini-key");
    expect(opts.model).toBe("gemini-2.5-pro");
  });

  it("falls back to default when neither payload nor env supplies a model", () => {
    const env = { ...baseEnv, GEMINI_MODEL: "" } as Bindings;
    const opts = resolveGeminiOpts(env, baseJob);
    expect(opts.model).toBe("gemini-2.5-flash");
  });
});
