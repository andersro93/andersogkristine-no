/**
 * Gallery admin mode for the couple: `/galleri?admin=<GALLERY_ADMIN_KEY>` sets
 * a separate signed cookie (purpose "gallery_admin", never interchangeable
 * with the site session). Wrong keys are rate-limited per IP like PIN guesses.
 */
import { getEnvVar } from "../env";
import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  SESSION_COOKIE_OPTIONS,
  secureCompare,
  signValue,
  verifyValue,
} from "../pin";

export const ADMIN_COOKIE_NAME = "gallery_admin";
export const ADMIN_COOKIE_OPTIONS = { ...SESSION_COOKIE_OPTIONS };
const ADMIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PURPOSE = "gallery_admin";

export function generateAdminCookie(env?: Env): string {
  return signValue(PURPOSE, Date.now() + ADMIN_TTL_MS, env);
}

export function verifyAdminCookie(value: string, env?: Env): boolean {
  return verifyValue(PURPOSE, value, env);
}

/** The subset of Astro's cookie API we need (keeps this testable without Astro). */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}
export interface CookieJar extends CookieReader {
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string, options?: Record<string, unknown>): void;
}

export function isGalleryAdmin(cookies: CookieReader, env?: Env): boolean {
  const cookie = cookies.get(ADMIN_COOKIE_NAME);
  return cookie ? verifyAdminCookie(cookie.value, env) : false;
}

export type AdminBootstrapOutcome = "none" | "granted" | "denied" | "logout";

/**
 * Handle `?admin=` on the gallery page. Returns "none" when the param is
 * absent (render normally); anything else means "redirect to a clean URL".
 */
export async function tryAdminBootstrap(
  ctx: { url: URL; cookies: CookieJar; clientAddress?: string },
  env?: Env,
): Promise<AdminBootstrapOutcome> {
  const key = ctx.url.searchParams.get("admin");
  if (key === null) return "none";
  if (key === "logout") {
    ctx.cookies.delete(ADMIN_COOKIE_NAME, { path: "/" });
    return "logout";
  }

  const ip = ctx.clientAddress || "unknown-ip";
  const kv = env?.CACHE;
  const limit = await checkRateLimit(ip, kv, "gallery_admin");
  if (!limit.allowed) return "denied";

  const expected = getEnvVar("GALLERY_ADMIN_KEY", env);
  if (!expected || !key || !secureCompare(key, expected)) {
    await recordFailedAttempt(ip, kv, "gallery_admin");
    return "denied";
  }

  await resetRateLimit(ip, kv, "gallery_admin");
  ctx.cookies.set(
    ADMIN_COOKIE_NAME,
    generateAdminCookie(env),
    ADMIN_COOKIE_OPTIONS,
  );
  return "granted";
}
