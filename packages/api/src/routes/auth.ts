import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "~/lib/errors";
import { validate } from "~/lib/validation";
import { createUser, findUserByGoogleId } from "~/repositories/user-repository";
import {
  decodeGoogleIdToken,
  exchangeDeviceCode,
  signToken,
  startDeviceFlow,
} from "~/services/auth-service";
import type { Env } from "~/types";

const tokenSchema = z.object({
  device_code: z.string().min(1),
});

const auth = new Hono<Env>()
  .get("/device", async (c) => {
    const result = await startDeviceFlow(c.env.GOOGLE_CLIENT_ID);
    return c.json(result);
  })
  .post("/token", validate("json", tokenSchema), async (c) => {
    const { device_code } = c.req.valid("json");

    const result = await exchangeDeviceCode(
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
      device_code,
    );

    if (result === "pending") {
      return c.json({ status: "pending" as const }, 428);
    }

    // `slow_down` means our poll cadence exceeded Google's limit; the client
    // must increase its interval. We surface it as 428 so the Device Flow
    // client loop stays in the polling state rather than erroring out.
    if (result === "slow_down") {
      return c.json({ status: "slow_down" as const }, 428);
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
