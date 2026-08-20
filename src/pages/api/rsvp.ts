import { env as rawEnv } from "cloudflare:workers";

const env = rawEnv as Env;

import type { APIRoute } from "astro";
import { fetchInviteByCode, updateGuestRSVP } from "../../services/notion";
import {
  checkRateLimit,
  LOCKOUT_MINUTES,
  recordFailedAttempt,
} from "../../services/pin";
import { validateRsvpPayload } from "../../services/rsvp";

interface RSVPRequestBody {
  code?: string;
  guests?: unknown;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const ip = context.clientAddress || "unknown-ip";
  const kv = env?.CACHE;

  try {
    let body: RSVPRequestBody;
    try {
      body = (await context.request.json()) as RSVPRequestBody;
    } catch {
      return json({ error: "Ugyldig forespørsel." }, 400);
    }

    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!code) {
      return json({ error: "Invitasjonskode mangler." }, 400);
    }

    // 1. Rate-limit invite-code guesses (shared with middleware / rsvp page)
    const limit = await checkRateLimit(ip, kv, "invite");
    if (!limit.allowed) {
      return json(
        {
          error: `For mange forsøk. Prøv igjen om ${LOCKOUT_MINUTES} minutter.`,
          locked: true,
        },
        429,
      );
    }

    // 2. Resolve the invite the caller claims to act on
    const invite = await fetchInviteByCode(code, env);
    if (!invite) {
      await recordFailedAttempt(ip, kv, "invite");
      return json({ error: "Ugyldig invitasjonskode." }, 403);
    }

    // 3. Validate every guest before writing anything
    const validation = validateRsvpPayload(invite, body.guests);
    if (!validation.ok) {
      return json({ error: validation.error }, 400);
    }

    // 4. Write sequentially so a failure leaves a clear, reportable state
    const failed: string[] = [];
    for (const update of validation.updates) {
      try {
        await updateGuestRSVP(update.id, update.rsvp, update.allergies, env);
      } catch (err) {
        console.error(`RSVP update failed for guest ${update.id}:`, err);
        failed.push(update.id);
      }
    }

    // 5. Invalidate the seating cache in Cloudflare KV
    if (kv) {
      try {
        await kv.delete("seating_data");
      } catch (cacheErr) {
        console.error("Failed to delete KV cache:", cacheErr);
      }
    }

    if (failed.length > 0) {
      return json(
        {
          error:
            failed.length === validation.updates.length
              ? "Klarte ikke å lagre svar. Vennligst prøv igjen."
              : "Noen av svarene ble ikke lagret. Vennligst prøv igjen.",
          failedGuestIds: failed,
        },
        500,
      );
    }

    return json({ success: true }, 200);
  } catch (error) {
    console.error("Error in RSVP API endpoint:", error);
    return json(
      { error: "Klarte ikke å lagre svar. Vennligst prøv igjen." },
      500,
    );
  }
};
