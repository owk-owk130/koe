import { sign, verify, decode } from "hono/jwt";

export type DeviceFlowResponse = {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
};

export type GoogleTokenResponse = {
  id_token: string;
  access_token: string;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
  name?: string;
};

export type JWTPayload = {
  sub: string;
  email: string;
  name?: string;
  iat: number;
  exp: number;
};

export const startDeviceFlow = async (clientId: string): Promise<DeviceFlowResponse> => {
  const res = await fetch("https://oauth2.googleapis.com/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      scope: "openid email profile",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google device flow failed: ${res.status} ${body}`);
  }

  return res.json<DeviceFlowResponse>();
};

export const exchangeDeviceCode = async (
  clientId: string,
  clientSecret: string,
  deviceCode: string,
): Promise<GoogleTokenResponse | "pending" | "expired"> => {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  if (!res.ok) {
    const body = await res.json<{ error: string }>();
    if (body.error === "authorization_pending") return "pending";
    if (body.error === "expired_token") return "expired";
    throw new Error(`Google token exchange failed: ${body.error}`);
  }

  return res.json<GoogleTokenResponse>();
};

export const decodeGoogleIdToken = (idToken: string): GoogleUserInfo => {
  const { payload } = decode(idToken);
  const p = payload as Record<string, unknown>;
  return {
    sub: p.sub as string,
    email: p.email as string,
    name: p.name as string | undefined,
  };
};

export const signToken = async (
  payload: { sub: string; email: string; name?: string },
  secret: string,
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      iat: now,
      exp: now + 30 * 24 * 60 * 60, // 30 days
    },
    secret,
  );
};

export const verifyToken = async (token: string, secret: string): Promise<JWTPayload> => {
  const payload = await verify(token, secret, "HS256");
  return payload as unknown as JWTPayload;
};
