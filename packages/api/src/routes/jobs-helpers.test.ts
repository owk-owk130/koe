import { describe, expect, it } from "vitest";
import { extractAiKeysFromHeaders } from "./jobs-helpers";

describe("extractAiKeysFromHeaders", () => {
  it("returns an empty object when no key headers are present", () => {
    const headers = new Headers();
    expect(extractAiKeysFromHeaders(headers)).toEqual({});
  });

  it("extracts gemini key/model and CF token/account id from headers", () => {
    const headers = new Headers({
      "X-Gemini-Key": "gem-123",
      "X-Gemini-Model": "gemini-2.5-pro",
      "X-Cf-Token": "cf-456",
      "X-Cf-Account-Id": "acct-789",
    });
    expect(extractAiKeysFromHeaders(headers)).toEqual({
      geminiApiKey: "gem-123",
      geminiModel: "gemini-2.5-pro",
      whisperApiKey: "cf-456",
      whisperAccountId: "acct-789",
    });
  });

  it("ignores empty header values", () => {
    const headers = new Headers({
      "X-Gemini-Key": "",
      "X-Gemini-Model": "  ",
    });
    expect(extractAiKeysFromHeaders(headers)).toEqual({});
  });

  it("trims surrounding whitespace from values", () => {
    const headers = new Headers({
      "X-Gemini-Key": "  gem-123  ",
    });
    expect(extractAiKeysFromHeaders(headers)).toEqual({ geminiApiKey: "gem-123" });
  });
});
