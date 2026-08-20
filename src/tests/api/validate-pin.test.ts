import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockEnv = {
  SESSION_SECRET: "test-secret-key-12345",
  SITE_PIN: "424242",
};

mock.module("cloudflare:workers", () => ({ env: mockEnv }));

const { POST, backoffDelayMs } = await import("../../pages/api/validate-pin");
const { clearMemoryCache, verifySessionCookie, MAX_ATTEMPTS } = await import(
  "../../services/pin"
);

function ctx(body: unknown, ip = "203.0.113.42") {
  const setCalls: Array<[string, string, any]> = [];
  return {
    clientAddress: ip,
    request: new Request("https://andersogkristine.no/api/validate-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    cookies: {
      get: () => undefined,
      set: (n: string, v: string, o: any) => setCalls.push([n, v, o]),
    },
    locals: {},
    _setCalls: setCalls,
  } as any;
}

describe("POST /api/validate-pin", () => {
  beforeEach(() => clearMemoryCache());

  test("backoff grows exponentially and caps at 8s", () => {
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(3)).toBe(8000);
    expect(backoffDelayMs(9)).toBe(8000);
  });

  test("correct PIN sets a valid lax session cookie", async () => {
    const c = ctx({ pin: " 424242 " });
    const res = await POST(c);
    expect(res.status).toBe(200);
    expect(c._setCalls).toHaveLength(1);
    const [name, value, opts] = c._setCalls[0];
    expect(name).toBe("wedding_access");
    expect(verifySessionCookie(value, mockEnv as any)).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.httpOnly).toBe(true);
    expect(opts.secure).toBe(true);
  });

  test("wrong PIN returns 401 with attempts remaining, no cookie", async () => {
    const c = ctx({ pin: "000000" });
    const res = await POST(c);
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.attemptsRemaining).toBe(MAX_ATTEMPTS - 1);
    expect(c._setCalls).toHaveLength(0);
  });

  test("locks out after MAX_ATTEMPTS failures and then returns 429", async () => {
    const ip = "198.51.100.77";
    let last: Response | null = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      last = await POST(ctx({ pin: "bad" }, ip));
    }
    expect(last?.status).toBe(403);
    const next = await POST(ctx({ pin: "424242" }, ip));
    expect(next.status).toBe(429);
  });

  test("missing pin returns 400", async () => {
    expect((await POST(ctx({}))).status).toBe(400);
    expect((await POST(ctx("nope"))).status).toBe(400);
  });
});
