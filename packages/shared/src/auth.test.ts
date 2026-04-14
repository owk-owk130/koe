import { describe, expect, it } from "vitest";
import { isTokenExpired, parseUser } from "./auth";

function createJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe("isTokenExpired", () => {
  it("returns false for a token with future exp", () => {
    const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("returns true for a token with past exp", () => {
    const token = createJwt({ exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns true for malformed token", () => {
    expect(isTokenExpired("not-a-jwt")).toBe(true);
  });
});

describe("parseUser", () => {
  it("extracts user info from a valid JWT", () => {
    const token = createJwt({
      sub: "user-1",
      email: "test@example.com",
      name: "Test User",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(parseUser(token)).toEqual({
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
    });
  });

  it("returns null for malformed token", () => {
    expect(parseUser("bad-token")).toBeNull();
  });

  it("handles missing name", () => {
    const token = createJwt({
      sub: "user-2",
      email: "no-name@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const user = parseUser(token);
    expect(user?.id).toBe("user-2");
    expect(user?.name).toBeUndefined();
  });
});
