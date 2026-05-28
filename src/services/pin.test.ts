import { beforeEach, describe, expect, test } from "bun:test";
import {
  checkRateLimit,
  clearMemoryCache,
  generateSessionCookie,
  recordFailedAttempt,
  resetRateLimit,
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
    const mockEnv = { SESSION_SECRET: "test-secret-key-12345" };

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
      const otherEnv = { SESSION_SECRET: "a-different-secret-key" };

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
  });

  describe("Rate Limiting & Brute-force Prevention", () => {
    const ip = "192.168.1.100";

    test("should allow attempts initially", async () => {
      const res = await checkRateLimit(ip);
      expect(res.allowed).toBe(true);
      expect(res.attemptsRemaining).toBe(5);
    });

    test("should decrement remaining attempts on failed attempt", async () => {
      const fail1 = await recordFailedAttempt(ip);
      expect(fail1.allowed).toBe(true);
      expect(fail1.attemptsRemaining).toBe(4);

      const status = await checkRateLimit(ip);
      expect(status.allowed).toBe(true);
      expect(status.attemptsRemaining).toBe(4);
    });

    test("should trigger lockout after 5 failures", async () => {
      // 1st, 2nd, 3rd, 4th failed attempts
      await recordFailedAttempt(ip);
      await recordFailedAttempt(ip);
      await recordFailedAttempt(ip);
      await recordFailedAttempt(ip);

      // 5th failed attempt -> locks out
      const fail5 = await recordFailedAttempt(ip);
      expect(fail5.allowed).toBe(false);
      expect(fail5.attemptsRemaining).toBe(0);
      expect(fail5.lockedUntil).toBeGreaterThan(Date.now());

      // Subsequent checks should return disallowed
      const checkLock = await checkRateLimit(ip);
      expect(checkLock.allowed).toBe(false);
      expect(checkLock.attemptsRemaining).toBe(0);
      expect(checkLock.lockedUntil).toBe(fail5.lockedUntil);
    });

    test("should reset rate limits on successful auth", async () => {
      await recordFailedAttempt(ip);
      await recordFailedAttempt(ip);

      let check = await checkRateLimit(ip);
      expect(check.attemptsRemaining).toBe(3);

      await resetRateLimit(ip);

      check = await checkRateLimit(ip);
      expect(check.allowed).toBe(true);
      expect(check.attemptsRemaining).toBe(5);
    });
  });
});
