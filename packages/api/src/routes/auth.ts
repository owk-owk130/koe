import { Hono } from "hono";
import type { Env } from "~/types";
import { AppError } from "~/lib/errors";
import {
  startDeviceFlow,
  exchangeDeviceCode,
  decodeGoogleIdToken,
  signToken,
} from "~/services/auth-service";
import { findUserByGoogleId, createUser } from "~/repositories/user-repository";

const auth = new Hono<Env>()
  .get("/device", async (c) => {
    const result = await startDeviceFlow(c.env.GOOGLE_CLIENT_ID);
    return c.json(result);
  })
  .post("/token", async (c) => {
    const body = await c.req.json<{ device_code?: string }>();
    if (!body.device_code) {
      throw new AppError(400, "BAD_REQUEST", "device_code is required");
    }

    const result = await exchangeDeviceCode(
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
      body.device_code,
    );

    if (result === "pending") {
      return c.json({ status: "pending" as const }, 428);
    }

    if (result === "expired") {
      throw new AppError(410, "EXPIRED", "Device code has expired");
    }

    const googleUser = decodeGoogleIdToken(result.id_token);

    let user = await findUserByGoogleId(c.env.DB, googleUser.sub);
    if (!user) {
      user = await createUser(c.env.DB, {
        id: crypto.randomUUID(),
        googleId: googleUser.sub,
        email: googleUser.email,
        name: googleUser.name,
      });
    }

    const token = await signToken(
      { sub: user.id, email: user.email, name: user.name ?? undefined },
      c.env.JWT_SECRET,
    );

    return c.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  });

export default auth;
