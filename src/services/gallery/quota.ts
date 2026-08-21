/**
 * Upload quota. Primary key is the *device* (a uuid the browser keeps in
 * localStorage) because a whole wedding venue shares one NAT IP; the IP hash
 * is only a high backstop against scripted abuse. Counts come from D1 so they
 * are consistent (KV counters are eventually consistent and ~1 write/s/key).
 */
import crypto from "node:crypto";
import { getEnvVar } from "../env";
import { countRecent } from "./db";

export const DEVICE_HOURLY_LIMIT = 100;
export const IP_HOURLY_LIMIT = 2000;
const HOUR_MS = 60 * 60 * 1000;

/** Keyed hash of the client IP — stored instead of the IP itself. */
export function hashIp(ip: string, env?: Env): string {
  const secret = getEnvVar("SESSION_SECRET", env) ?? "";
  return crypto
    .createHash("sha256")
    .update(`${ip}:${secret}`)
    .digest("hex")
    .slice(0, 32);
}

export type QuotaResult =
  | { allowed: true }
  | { allowed: false; reason: "device" | "ip" };

export async function checkUploadQuota(
  db: D1Database,
  p: { deviceId: string; ipHash: string | null; now: number },
): Promise<QuotaResult> {
  const since = p.now - HOUR_MS;
  if (
    (await countRecent(db, "device_id", p.deviceId, since)) >=
    DEVICE_HOURLY_LIMIT
  ) {
    return { allowed: false, reason: "device" };
  }
  if (
    p.ipHash &&
    (await countRecent(db, "ip_hash", p.ipHash, since)) >= IP_HOURLY_LIMIT
  ) {
    return { allowed: false, reason: "ip" };
  }
  return { allowed: true };
}
