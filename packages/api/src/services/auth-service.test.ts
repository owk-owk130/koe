import { describe, expect, it } from "vitest";
import { decodeGoogleIdToken, signToken, verifyToken } from "./auth-service";

const TEST_SECRET = "test-secret-key-for-jwt";

describe("auth-service", () => {
  describe("signToken / verifyToken", () => {
    it("signs and verifies a JWT token", async () => {
      const token = await signToken(
        { sub: "user-1", email: "test@example.com", name: "Test" },
        TEST_SECRET,
      );

      const payload = await verifyToken(token, TEST_SECRET);
      expect(payload.sub).toBe("user-1");
      expect(payload.email).toBe("test@example.com");
      expect(payload.name).toBe("Test");
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it("rejects token with wrong secret", async () => {
      const token = await signToken({ sub: "user-1", email: "test@example.com" }, TEST_SECRET);

      await expect(verifyToken(token, "wrong-secret")).rejects.toThrow();
    });
  });

  describe("decodeGoogleIdToken", () => {
    const makeToken = (payload: Record<string, unknown>) => {
      const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const body = btoa(JSON.stringify(payload))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      return `${header}.${body}.fakesig`;
    };

    it("decodes a Google ID token payload", () => {
      const token = makeToken({
        sub: "google-123",
        email: "user@gmail.com",
        name: "Google User",
      });

      const info = decodeGoogleIdToken(token);
      expect(info.sub).toBe("google-123");
      expect(info.email).toBe("user@gmail.com");
      expect(info.name).toBe("Google User");
    });

    it("throws on missing sub", () => {
      const token = makeToken({ email: "user@gmail.com" });
      expect(() => decodeGoogleIdToken(token)).toThrow("missing sub or email");
    });

    it("throws on missing email", () => {
      const token = makeToken({ sub: "google-123" });
      expect(() => decodeGoogleIdToken(token)).toThrow("missing sub or email");
    });

    it("handles missing name gracefully", () => {
      const token = makeToken({ sub: "google-123", email: "user@gmail.com" });
      const info = decodeGoogleIdToken(token);
      expect(info.name).toBeUndefined();
    });
  });
});
