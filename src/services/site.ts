import { getEnvVar } from "./env";

/**
 * `SITE_CLOSED` turns the whole site into a single thank-you landing page
 * after the wedding. Nothing is deleted: the middleware redirects every other
 * route to `/`, and `/` renders the landing page instead of the invitation.
 * Reopen by setting the variable to `false` (or removing it).
 */
export function isSiteClosed(env?: Env): boolean {
  const raw = getEnvVar("SITE_CLOSED", env);
  if (typeof raw !== "string") return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
