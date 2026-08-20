import { notionConfig } from "../config/notion";
import { type Invite, sanitizeAllergyItems } from "./notion";

/** RSVP values a guest may submit. "Venter" is reserved for the organisers. */
export const ALLOWED_RSVP_VALUES: readonly string[] = [
  notionConfig.rsvpStatus.attending,
  notionConfig.rsvpStatus.declined,
];

export interface GuestUpdate {
  id: string;
  rsvp: string;
  allergies: string[];
}

export type ValidationResult =
  | { ok: true; updates: GuestUpdate[] }
  | { ok: false; error: string };

/**
 * Validate an RSVP payload against the invite it claims to belong to.
 * Every guest id must belong to the invite and every rsvp value must be allowed.
 * Returns either the normalised list of updates or a user-facing error.
 */
export function validateRsvpPayload(
  invite: Invite,
  guests: unknown,
): ValidationResult {
  if (!Array.isArray(guests) || guests.length === 0) {
    return { ok: false, error: "Ugyldig forespørsel. Gjester mangler." };
  }

  const inviteGuestIds = new Set(invite.guests.map((g) => g.id));
  const updates: GuestUpdate[] = [];
  const seen = new Set<string>();

  for (const guest of guests) {
    if (!guest || typeof guest !== "object") {
      return { ok: false, error: "Ugyldig gjest i forespørselen." };
    }
    const { id, rsvp, allergies } = guest as Record<string, unknown>;

    if (typeof id !== "string" || !inviteGuestIds.has(id)) {
      return {
        ok: false,
        error: "En av gjestene tilhører ikke denne invitasjonen.",
      };
    }
    if (seen.has(id)) {
      return { ok: false, error: "Samme gjest er sendt inn flere ganger." };
    }
    seen.add(id);

    if (typeof rsvp !== "string" || !ALLOWED_RSVP_VALUES.includes(rsvp)) {
      return {
        ok: false,
        error: "Ugyldig svar. Velg «Kommer» eller «Kommer ikke».",
      };
    }

    updates.push({
      id,
      rsvp,
      // Allergies are only meaningful for attending guests. The form sends a
      // list of items; sanitizeAllergyItems also tolerates comma-joined strings.
      allergies:
        rsvp === notionConfig.rsvpStatus.attending
          ? sanitizeAllergyItems(
              Array.isArray(allergies) ? allergies : [allergies],
            )
          : [],
    });
  }

  return { ok: true, updates };
}
