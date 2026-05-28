import type { Env } from "cloudflare:workers";
import crypto from "node:crypto";
import { getEnvVar } from "./env";

// In-memory fallback rate-limiting cache for local development
const memoryCache = new Map<string, string>();

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
 */
function getSessionSecret(env?: Env): string {
  return (
    getEnvVar("SESSION_SECRET", env) ||
    getEnvVar("NOTION_API_KEY", env) ||
    "fallback-wedding-session-secret-key-development"
  );
}

/**
 * Generate a secure, cryptographically signed session cookie value.
 * The cookie is valid for 30 days and includes an expiration date.
 */
export function generateSessionCookie(env?: Env): string {
  const secret = getSessionSecret(env);
  const expiration = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const message = `session:${expiration}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  return `${expiration}.${signature}`;
}

/**
 * Verify a signed session cookie value.
 * Returns true if the cookie signature is valid and it has not expired.
 */
export function verifySessionCookie(cookieValue: string, env?: Env): boolean {
  try {
    const parts = cookieValue.split(".");
    if (parts.length !== 2) return false;

    const [expirationStr, signature] = parts;
    const expiration = parseInt(expirationStr, 10);

    // Check if expired
    if (Number.isNaN(expiration) || expiration < Date.now()) {
      return false;
    }

    const secret = getSessionSecret(env);
    const message = `session:${expiration}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(message)
      .digest("hex");

    const buf1 = Buffer.from(signature, "hex");
    const buf2 = Buffer.from(expectedSignature, "hex");

    if (buf1.length !== buf2.length) {
      return false;
    }

    return crypto.timingSafeEqual(buf1, buf2);
  } catch {
    return false;
  }
}

/**
 * Retrieves the rate limit data for a given IP.
 */
async function getRateLimitData(
  ip: string,
  kv?: KVNamespace,
): Promise<RateLimitData> {
  const key = `pin_limit:${ip}`;
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
 * Saves rate limit data for a given IP.
 */
async function saveRateLimitData(
  ip: string,
  data: RateLimitData,
  kv?: KVNamespace,
): Promise<void> {
  const key = `pin_limit:${ip}`;
  const dataStr = JSON.stringify(data);

  if (kv) {
    try {
      // Keep rate limit keys for 1 hour
      await kv.put(key, dataStr, { expirationTtl: 3600 });
    } catch (err) {
      console.error("KV write error in rate limiter:", err);
    }
  } else {
    memoryCache.set(key, dataStr);
  }
}

/**
 * Check if the IP is allowed to attempt a PIN validation.
 */
export async function checkRateLimit(
  ip: string,
  kv?: KVNamespace,
): Promise<RateLimitResult> {
  const data = await getRateLimitData(ip, kv);
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
    await saveRateLimitData(ip, data, kv);
  }

  return {
    allowed: true,
    lockedUntil: 0,
    attemptsRemaining: Math.max(0, 5 - data.attempts),
  };
}

/**
 * Record a failed attempt. Locks the IP for 15 minutes on the 5th failure.
 * Returns the lockout status.
 */
export async function recordFailedAttempt(
  ip: string,
  kv?: KVNamespace,
): Promise<RateLimitResult> {
  const data = await getRateLimitData(ip, kv);
  const now = Date.now();

  data.attempts += 1;
  data.lastAttempt = now;

  if (data.attempts >= 5) {
    data.lockedUntil = now + 15 * 60 * 1000; // 15 minutes lockout
  }

  await saveRateLimitData(ip, data, kv);

  return {
    allowed: data.lockedUntil === 0,
    lockedUntil: data.lockedUntil,
    attemptsRemaining: Math.max(0, 5 - data.attempts),
  };
}

/**
 * Reset the rate limiter upon successful authentication.
 */
export async function resetRateLimit(
  ip: string,
  kv?: KVNamespace,
): Promise<void> {
  const key = `pin_limit:${ip}`;
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
 * Helper to get rate limit cache keys for testing/clearing memory cache.
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}
