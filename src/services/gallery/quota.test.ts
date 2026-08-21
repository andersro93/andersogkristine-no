import { describe, expect, test } from "bun:test";
import { createFakeD1, readMigration } from "../../tests/fakes/d1";
import { createItem } from "./db";
import {
  checkUploadQuota,
  DEVICE_HOURLY_LIMIT,
  hashIp,
  IP_HOURLY_LIMIT,
} from "./quota";

const env = { SESSION_SECRET: "s3cret" } as Env;

describe("hashIp", () => {
  test("deterministic, secret-dependent, not the raw ip", () => {
    const a = hashIp("203.0.113.7", env);
    expect(a).toBe(hashIp("203.0.113.7", env));
    expect(a).not.toBe(
      hashIp("203.0.113.7", { SESSION_SECRET: "other" } as Env),
    );
    expect(a).not.toContain("203.0.113.7");
    expect(a).toHaveLength(32);
  });
});

describe("checkUploadQuota", () => {
  async function seed(
    db: D1Database,
    n: number,
    deviceId: string,
    ipHash: string,
    at: number,
  ) {
    for (let i = 0; i < n; i++) {
      await createItem(db, {
        id: crypto.randomUUID(),
        kind: "image",
        createdAt: at,
        name: null,
        deviceId,
        ipHash,
        width: null,
        height: null,
        durationMs: null,
        originalMime: "image/jpeg",
      });
    }
  }

  test("allows under the limits", async () => {
    const db = createFakeD1(readMigration());
    await seed(db, 3, "dev", "ip", 1000);
    expect(
      await checkUploadQuota(db, { deviceId: "dev", ipHash: "ip", now: 2000 }),
    ).toEqual({ allowed: true });
  });

  test("blocks a device at DEVICE_HOURLY_LIMIT within the hour, allows again after", async () => {
    const db = createFakeD1(readMigration());
    await seed(db, DEVICE_HOURLY_LIMIT, "dev", "ip", 1000);
    expect(
      await checkUploadQuota(db, { deviceId: "dev", ipHash: "ip", now: 2000 }),
    ).toEqual({ allowed: false, reason: "device" });
    expect(
      await checkUploadQuota(db, {
        deviceId: "other",
        ipHash: "ip",
        now: 2000,
      }),
    ).toEqual({ allowed: true });
    expect(
      await checkUploadQuota(db, {
        deviceId: "dev",
        ipHash: "ip",
        now: 1000 + 3_600_001,
      }),
    ).toEqual({ allowed: true });
  });

  test("IP backstop trips across many devices", async () => {
    const db = createFakeD1(readMigration());
    for (let d = 0; d < 25; d++)
      await seed(db, IP_HOURLY_LIMIT / 25, `dev-${d}`, "venue", 1000);
    expect(
      await checkUploadQuota(db, {
        deviceId: "fresh",
        ipHash: "venue",
        now: 2000,
      }),
    ).toEqual({ allowed: false, reason: "ip" });
    expect(
      await checkUploadQuota(db, {
        deviceId: "fresh",
        ipHash: null,
        now: 2000,
      }),
    ).toEqual({ allowed: true });
  });
});
