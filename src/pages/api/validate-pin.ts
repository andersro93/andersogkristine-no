import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import type { APIRoute } from "astro";
import {
  checkRateLimit,
  generateSessionCookie,
  getSitePin,
  LOCKOUT_MINUTES,
  MAX_ATTEMPTS,
  recordFailedAttempt,
  resetRateLimit,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  secureCompare,
} from "../../services/pin";

interface ValidatePinRequestBody {
  pin?: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Exponential backoff on failures to slow down brute force (capped at 8s). */
export function backoffDelayMs(failedAttempts: number): number {
  return Math.min(1000 * 2 ** failedAttempts, 8000);
}

export const POST: APIRoute = async (context) => {
  const ip = context.clientAddress || "unknown-ip";
  const kv = env?.CACHE;

  try {
    // 1. Check rate limit
    const limitStatus = await checkRateLimit(ip, kv, "pin");
    if (!limitStatus.allowed) {
      const remainingTime = Math.max(
        1,
        Math.ceil((limitStatus.lockedUntil - Date.now()) / 1000 / 60),
      );
      return json(
        {
          error: `For mange forsøk. Prøv igjen om ${remainingTime} minutter.`,
          locked: true,
          lockedUntil: limitStatus.lockedUntil,
        },
        429,
      );
    }

    // 2. Parse request body
    let body: ValidatePinRequestBody;
    try {
      body = (await context.request.json()) as ValidatePinRequestBody;
    } catch {
      return json({ error: "PIN-kode mangler." }, 400);
    }
    const pin = body?.pin;

    if (!pin || typeof pin !== "string") {
      return json({ error: "PIN-kode mangler." }, 400);
    }

    // 3. Compare with correct PIN (getSitePin throws in prod if unset)
    const expectedPin = getSitePin(env);
    const isCorrect = secureCompare(pin.trim(), expectedPin.trim());

    if (isCorrect) {
      await resetRateLimit(ip, kv, "pin");
      const cookieValue = generateSessionCookie(env);
      context.cookies.set(
        SESSION_COOKIE_NAME,
        cookieValue,
        SESSION_COOKIE_OPTIONS,
      );
      return json({ success: true }, 200);
    }

    // 4. Handle failure
    const failStatus = await recordFailedAttempt(ip, kv, "pin");
    const failedAttempts = MAX_ATTEMPTS - failStatus.attemptsRemaining;

    if (process.env.NODE_ENV !== "test") {
      await new Promise((resolve) =>
        setTimeout(resolve, backoffDelayMs(failedAttempts)),
      );
    }

    if (!failStatus.allowed) {
      return json(
        {
          error: `Feil PIN. Du har blitt midlertidig blokkert i ${LOCKOUT_MINUTES} minutter.`,
          locked: true,
          attemptsRemaining: 0,
        },
        403,
      );
    }

    return json(
      {
        error: `Feil PIN-kode. Du har ${failStatus.attemptsRemaining} forsøk igjen.`,
        locked: false,
        attemptsRemaining: failStatus.attemptsRemaining,
      },
      401,
    );
  } catch (error) {
    console.error("Error validating PIN:", error);
    return json({ error: "Det oppstod en intern feil." }, 500);
  }
};
