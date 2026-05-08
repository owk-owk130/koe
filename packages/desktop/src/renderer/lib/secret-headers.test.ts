import { describe, expect, it } from "vitest";
import { buildSecretHeaders } from "./secret-headers";

describe("buildSecretHeaders", () => {
  it("returns no headers when secrets are empty", () => {
    expect(buildSecretHeaders({})).toEqual({});
  });

  it("maps each secret to its API header name", () => {
    expect(
      buildSecretHeaders({
        geminiApiKey: "gem",
        geminiModel: "gemini-2.5-pro",
        cfApiToken: "cf",
        cfAccountId: "acct",
      }),
    ).toEqual({
      "X-Gemini-Key": "gem",
      "X-Gemini-Model": "gemini-2.5-pro",
      "X-Cf-Token": "cf",
      "X-Cf-Account-Id": "acct",
    });
  });

  it("omits headers for empty-string values", () => {
    expect(
      buildSecretHeaders({
        geminiApiKey: "",
        geminiModel: "gemini-2.5-pro",
        cfApiToken: undefined,
      }),
    ).toEqual({ "X-Gemini-Model": "gemini-2.5-pro" });
  });
});
