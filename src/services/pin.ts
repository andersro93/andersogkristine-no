import crypto from "node:crypto";
import { getEnvVar } from "./env";

// In-memory fallback rate-limiting cache for local development / tests
const memoryCache = new Map<string, string>();

/** Max failed attempts before a temporary lockout (per IP, per scope). */
export const MAX_ATTEMPTS = 10;
/** Lockout duration after MAX_ATTEMPTS failures. */
export const LOCKOUT_MS = 5 * 60 * 1000;
export const LOCKOUT_MINUTES = LOCKOUT_MS / 60 / 1000;
/** How long a rate-limit record lives in KV. */
const RATE_LIMIT_TTL_SECONDS = 60 * 60;

/**
 * Rate-limit scopes. Each scope has its own counter per IP so that e.g.
 * invite-code guesses do not consume PIN attempts and vice versa.
 */
export type RateLimitScope = "pin" | "invite" | "gallery_admin";

export interface RateLimitData {
  attempts: number;
  lastAttempt: number;
  lockedUntil: number;
}

export interface RateLimitResult {
  allowed: boolean;
  lockedUntil: number;
  attemptsRemaining: number;
}

const isDev = (): boolean =>
  (import.meta as any).env?.DEV === true ||
  process.env.NODE_ENV === "development";

/**
 * Perform a timing-safe comparison between two strings to prevent timing attacks.
 * It hashes both strings to SHA-256 (resulting in equal length buffers) and compares them.
 */
export function secureCompare(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Retrieve the secret key used for session signing.
 * Fails closed: in production a missing SESSION_SECRET is a configuration error.
 */
function getSessionSecret(env?: Env): string {
  const secret = getEnvVar("SESSION_SECRET", env);
  if (secret) return secret;
  if (isDev()) return "dev-only-session-secret-do-not-use-in-prod";
  throw new Error(
    "SESSION_SECRET is not configured. Set it with `wrangler secret put SESSION_SECRET`.",
  );
}

/**
 * Retrieve the site PIN. Fails closed in production when unset.
 */
export function getSitePin(env?: Env): string {
  const pin = getEnvVar("SITE_PIN", env);
  if (pin) return pin;
  if (isDev()) return "1234";
  throw new Error(
    "SITE_PIN is not configured. Set it with `wrangler secret put SITE_PIN`.",
  );
}

/**
 * Sign `${purpose}:${expiresAt}` with SESSION_SECRET. The purpose namespaces
 * cookies (site session vs. gallery admin) so one can never be replayed as
 * the other. Format: `<expiresAt>.<hmac-hex>`.
 */
export function signValue(
  purpose: string,
  expiresAt: number,
  env?: Env,
): string {
  const secret = getSessionSecret(env);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${purpose}:${expiresAt}`)
    .digest("hex");
  return `${expiresAt}.${signature}`;
}

/** Verify a value produced by signValue(): valid signature for `purpose` and not expired. */
export function verifyValue(
  purpose: string,
  value: string,
  env?: Env,
): boolean {
  try {
    const parts = value.split(".");
    if (parts.length !== 2) return false;
    const [expirationStr, signature] = parts;
    const expiration = parseInt(expirationStr, 10);
    if (Number.isNaN(expiration) || expiration < Date.now()) return false;

    const secret = getSessionSecret(env);
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${purpose}:${expiration}`)
      .digest("hex");
    // Compare hex string lengths first: Buffer.from(hex, "hex") silently
    // drops a trailing odd character, so a length check on the *decoded*
    // buffers alone would miss a single appended hex digit.
    if (signature.length !== expected.length) return false;
    const buf1 = Buffer.from(signature, "hex");
    const buf2 = Buffer.from(expected, "hex");
    if (buf1.length !== buf2.length || buf1.length === 0) return false;
    return crypto.timingSafeEqual(buf1, buf2);
  } catch {
    return false;
  }
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Site-wide access cookie value (30 days). */
export function generateSessionCookie(env?: Env): string {
  return signValue("session", Date.now() + SESSION_TTL_MS, env);
}

/** Verify the site-wide access cookie. */
export function verifySessionCookie(cookieValue: string, env?: Env): boolean {
  return verifyValue("session", cookieValue, env);
}

/**
 * Shared cookie options for the site-wide access cookie.
 * `lax` (not `strict`) so the cookie is sent when guests arrive via links
 * from messaging apps / email (top-level navigations).
 */
export const SESSION_COOKIE_NAME = "wedding_access";
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60, // 30 days
};

function rateLimitKey(scope: RateLimitScope, ip: string): string {
  return `${scope}_limit:${ip}`;
}

/**
 * Retrieves the rate limit data for a given IP + scope.
 */
async function getRateLimitData(
  key: string,
  kv?: KVNamespace,
): Promise<RateLimitData> {
  let dataStr: string | null = null;

  if (kv) {
    try {
      dataStr = await kv.get(key);
    } catch (err) {
      console.error("KV read error in rate limiter:", err);
    }
  } else {
    dataStr = memoryCache.get(key) || null;
  }

  if (!dataStr) {
    return { attempts: 0, lastAttempt: 0, lockedUntil: 0 };
  }

  try {
    return JSON.parse(dataStr);
  } catch {
    return { attempts: 0, lastAttempt: 0, lockedUntil: 0 };
  }
}

/**
 * Saves rate limit data for a given key.
 */
async function saveRateLimitData(
  key: string,
  data: RateLimitData,
  kv?: KVNamespace,
): Promise<void> {
  const dataStr = JSON.stringify(data);

  if (kv) {
    try {
      await kv.put(key, dataStr, { expirationTtl: RATE_LIMIT_TTL_SECONDS });
    } catch (err) {
      console.error("KV write error in rate limiter:", err);
    }
  } else {
    memoryCache.set(key, dataStr);
  }
}

/**
 * Check if the IP is allowed to make another attempt in the given scope.
 */
export async function checkRateLimit(
  ip: string,
  kv?: KVNamespace,
  scope: RateLimitScope = "pin",
): Promise<RateLimitResult> {
  const key = rateLimitKey(scope, ip);
  const data = await getRateLimitData(key, kv);
  const now = Date.now();

  if (data.lockedUntil > now) {
    return {
      allowed: false,
      lockedUntil: data.lockedUntil,
      attemptsRemaining: 0,
    };
  }

  // If a lock expired, reset attempts
  if (data.lockedUntil > 0 && data.lockedUntil <= now) {
    data.attempts = 0;
    data.lockedUntil = 0;
    await saveRateLimitData(key, data, kv);
  }

  return {
    allowed: true,
    lockedUntil: 0,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - data.attempts),
  };
}

/**
 * Record a failed attempt. Locks the IP for LOCKOUT_MS on the MAX_ATTEMPTS-th failure.
 * Returns the lockout status.
 */
export async function recordFailedAttempt(
  ip: string,
  kv?: KVNamespace,
  scope: RateLimitScope = "pin",
): Promise<RateLimitResult> {
  const key = rateLimitKey(scope, ip);
  const data = await getRateLimitData(key, kv);
  const now = Date.now();

  data.attempts += 1;
  data.lastAttempt = now;

  if (data.attempts >= MAX_ATTEMPTS) {
    data.lockedUntil = now + LOCKOUT_MS;
  }

  await saveRateLimitData(key, data, kv);

  return {
    allowed: data.lockedUntil === 0,
    lockedUntil: data.lockedUntil,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - data.attempts),
  };
}

/**
 * Reset the rate limiter upon successful authentication.
 */
export async function resetRateLimit(
  ip: string,
  kv?: KVNamespace,
  scope: RateLimitScope = "pin",
): Promise<void> {
  const key = rateLimitKey(scope, ip);
  if (kv) {
    try {
      await kv.delete(key);
    } catch (err) {
      console.error("KV delete error in rate limiter:", err);
    }
  } else {
    memoryCache.delete(key);
  }
}

/**
 * Sanitize a post-login redirect target. Only same-origin relative paths are
 * allowed (no `//host`, no scheme). Anything else falls back to "/".
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (/^\/(?![/\\])/.test(next)) return next;
  return "/";
}

/**
 * Helper to clear the in-memory rate limit cache (tests).
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}
