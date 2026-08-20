import { beforeEach, describe, expect, test } from "bun:test";
import { __setCloudflareEnvForTests, cloudflareEnv } from "./env";
import {
  checkRateLimit,
  clearMemoryCache,
  generateSessionCookie,
  getSitePin,
  MAX_ATTEMPTS,
  recordFailedAttempt,
  resetRateLimit,
  safeNextPath,
  secureCompare,
  verifySessionCookie,
} from "./pin";

describe("Security Gate - PIN & Session Controls", () => {
  beforeEach(() => {
    clearMemoryCache();
  });

  describe("secureCompare", () => {
    test("should match identical strings", () => {
      expect(secureCompare("1234", "1234")).toBe(true);
      expect(secureCompare("my-secret-pin", "my-secret-pin")).toBe(true);
    });

    test("should not match differing strings", () => {
      expect(secureCompare("1234", "1235")).toBe(false);
      expect(secureCompare("1234", "12345")).toBe(false);
      expect(secureCompare("1234", "")).toBe(false);
    });
  });

  describe("Signed Cookie Sessions", () => {
    const mockEnv = {
      SESSION_SECRET: "test-secret-key-12345",
    } as unknown as Env;

    test("should generate and verify a valid session cookie", () => {
      const cookieVal = generateSessionCookie(mockEnv);
      expect(cookieVal).toContain(".");

      const isValid = verifySessionCookie(cookieVal, mockEnv);
      expect(isValid).toBe(true);
    });

    test("should reject forged/modified signatures", () => {
      const cookieVal = generateSessionCookie(mockEnv);
      const [expiration, signature] = cookieVal.split(".");

      // Tamper with the signature
      const tamperedCookie = `${expiration}.${signature.slice(0, -2)}xx`;
      expect(verifySessionCookie(tamperedCookie, mockEnv)).toBe(false);

      // Tamper with the expiration timestamp
      const changedExpiration = `${Number(expiration) + 1000}.${signature}`;
      expect(verifySessionCookie(changedExpiration, mockEnv)).toBe(false);
    });

    test("should reject cookies signed with a different secret", () => {
      const cookieVal = generateSessionCookie(mockEnv);
      const otherEnv = {
        SESSION_SECRET: "a-different-secret-key",
      } as unknown as Env;

      expect(verifySessionCookie(cookieVal, otherEnv)).toBe(false);
    });

    test("should reject expired session cookies", () => {
      // Formulate a custom cookie that expired 5 seconds ago
      const expiredTime = Date.now() - 5000;
      const message = `session:${expiredTime}`;
      const crypto = require("node:crypto");
      const signature = crypto
        .createHmac("sha256", "test-secret-key-12345")
        .update(message)
        .digest("hex");
      const expiredCookie = `${expiredTime}.${signature}`;

      expect(verifySessionCookie(expiredCookie, mockEnv)).toBe(false);
    });

    test("should handle malformed cookies gracefully", () => {
      expect(verifySessionCookie("malformedcookievalue", mockEnv)).toBe(false);
      expect(verifySessionCookie("abc.def.ghi", mockEnv)).toBe(false);
      expect(verifySessionCookie("", mockEnv)).toBe(false);
    });

    test("should fail closed when SESSION_SECRET is missing outside dev", () => {
      const prev = process.env.NODE_ENV;
      const prevSecret = process.env.SESSION_SECRET;
      const prevCfEnv = cloudflareEnv;
      process.env.NODE_ENV = "production";
      delete process.env.SESSION_SECRET; // bun auto-loads .env
      __setCloudflareEnvForTests(undefined); // other test files mock cloudflare:workers
      try {
        expect(() => generateSessionCookie({} as unknown as Env)).toThrow(
          /SESSION_SECRET/,
        );
        // Verification must not throw, just reject
        expect(verifySessionCookie("123.abc", {} as unknown as Env)).toBe(
          false,
        );
      } finally {
        process.env.NODE_ENV = prev;
        if (prevSecret !== undefined) process.env.SESSION_SECRET = prevSecret;
        __setCloudflareEnvForTests(prevCfEnv);
      }
    });

    test("should fail closed when SITE_PIN is missing outside dev", () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const prevPin = process.env.SITE_PIN;
      const prevCfEnv = cloudflareEnv;
      delete process.env.SITE_PIN;
      __setCloudflareEnvForTests(undefined);
      try {
        expect(() => getSitePin({} as unknown as Env)).toThrow(/SITE_PIN/);
        expect(getSitePin({ SITE_PIN: "9999" } as unknown as Env)).toBe("9999");
      } finally {
        process.env.NODE_ENV = prev;
        if (prevPin !== undefined) process.env.SITE_PIN = prevPin;
        __setCloudflareEnvForTests(prevCfEnv);
      }
    });
  });

  describe("safeNextPath", () => {
    test("allows same-origin relative paths", () => {
      expect(safeNextPath("/musikk")).toBe("/musikk");
      expect(safeNextPath("/?code=abc")).toBe("/?code=abc");
    });
    test("rejects absolute URLs, protocol-relative and backslash tricks", () => {
      expect(safeNextPath("https://evil.no")).toBe("/");
      expect(safeNextPath("//evil.no")).toBe("/");
      expect(safeNextPath("/\\evil.no")).toBe("/");
      expect(safeNextPath("")).toBe("/");
      expect(safeNextPath(null)).toBe("/");
    });
  });

  describe("Rate Limiting & Brute-force Prevention", () => {
    const ip = "192.168.1.100";

    test("should allow attempts initially", async () => {
      const res = await checkRateLimit(ip);
      expect(res.allowed).toBe(true);
      expect(res.attemptsRemaining).toBe(MAX_ATTEMPTS);
    });

    test("should decrement remaining attempts on failed attempt", async () => {
      const fail1 = await recordFailedAttempt(ip);
      expect(fail1.allowed).toBe(true);
      expect(fail1.attemptsRemaining).toBe(MAX_ATTEMPTS - 1);

      const status = await checkRateLimit(ip);
      expect(status.allowed).toBe(true);
      expect(status.attemptsRemaining).toBe(MAX_ATTEMPTS - 1);
    });

    test(`should trigger lockout after ${MAX_ATTEMPTS} failures`, async () => {
      for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
        const r = await recordFailedAttempt(ip);
        expect(r.allowed).toBe(true);
      }

      const last = await recordFailedAttempt(ip);
      expect(last.allowed).toBe(false);
      expect(last.attemptsRemaining).toBe(0);
      expect(last.lockedUntil).toBeGreaterThan(Date.now());

      // Subsequent checks should return disallowed
      const checkLock = await checkRateLimit(ip);
      expect(checkLock.allowed).toBe(false);
      expect(checkLock.attemptsRemaining).toBe(0);
      expect(checkLock.lockedUntil).toBe(last.lockedUntil);
    });

    test("should reset rate limits on successful auth", async () => {
      await recordFailedAttempt(ip);
      await recordFailedAttempt(ip);

      let check = await checkRateLimit(ip);
      expect(check.attemptsRemaining).toBe(MAX_ATTEMPTS - 2);

      await resetRateLimit(ip);

      check = await checkRateLimit(ip);
      expect(check.allowed).toBe(true);
      expect(check.attemptsRemaining).toBe(MAX_ATTEMPTS);
    });

    test("should keep pin and invite scopes independent", async () => {
      await recordFailedAttempt(ip, undefined, "invite");
      await recordFailedAttempt(ip, undefined, "invite");

      const pinStatus = await checkRateLimit(ip, undefined, "pin");
      expect(pinStatus.attemptsRemaining).toBe(MAX_ATTEMPTS);

      const inviteStatus = await checkRateLimit(ip, undefined, "invite");
      expect(inviteStatus.attemptsRemaining).toBe(MAX_ATTEMPTS - 2);

      await resetRateLimit(ip, undefined, "invite");
      expect(
        (await checkRateLimit(ip, undefined, "invite")).attemptsRemaining,
      ).toBe(MAX_ATTEMPTS);
    });
  });
});
