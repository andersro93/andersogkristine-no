import { beforeEach, describe, expect, test } from "bun:test";
import { clearMemoryCache, MAX_ATTEMPTS } from "../pin";
import {
  ADMIN_COOKIE_NAME,
  generateAdminCookie,
  isGalleryAdmin,
  tryAdminBootstrap,
  verifyAdminCookie,
} from "./admin";

const env = {
  SESSION_SECRET: "test-secret-key-12345",
  GALLERY_ADMIN_KEY: "hemmelig-nøkkel",
} as Env;

function jar(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const sets: Array<[string, string, any]> = [];
  return {
    get: (n: string) =>
      store.has(n) ? { value: store.get(n) as string } : undefined,
    set: (n: string, v: string, o?: any) => {
      store.set(n, v);
      sets.push([n, v, o]);
    },
    delete: (n: string) => {
      store.delete(n);
    },
    _sets: sets,
    _store: store,
  };
}

describe("admin cookie", () => {
  test("generate/verify round-trip; session cookie is not an admin cookie", () => {
    const v = generateAdminCookie(env);
    expect(verifyAdminCookie(v, env)).toBe(true);
    expect(verifyAdminCookie(`${v}x`, env)).toBe(false);
    expect(isGalleryAdmin(jar({ [ADMIN_COOKIE_NAME]: v }), env)).toBe(true);
    expect(isGalleryAdmin(jar(), env)).toBe(false);
  });
});

describe("tryAdminBootstrap", () => {
  beforeEach(() => clearMemoryCache());
  const url = (q: string) => new URL(`https://andersogkristine.no/galleri${q}`);

  test("no ?admin → none", async () => {
    expect(await tryAdminBootstrap({ url: url(""), cookies: jar() }, env)).toBe(
      "none",
    );
  });
  test("correct key → granted and cookie set with httpOnly/lax", async () => {
    const c = jar();
    expect(
      await tryAdminBootstrap(
        {
          url: url("?admin=hemmelig-n%C3%B8kkel"),
          cookies: c,
          clientAddress: "1.1.1.1",
        },
        env,
      ),
    ).toBe("granted");
    expect(c._sets[0][0]).toBe(ADMIN_COOKIE_NAME);
    expect(c._sets[0][2]).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    expect(isGalleryAdmin(c, env)).toBe(true);
  });
  test("wrong key → denied, no cookie; locks out after MAX_ATTEMPTS", async () => {
    const c = jar();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(
        await tryAdminBootstrap(
          { url: url("?admin=feil"), cookies: c, clientAddress: "2.2.2.2" },
          env,
        ),
      ).toBe("denied");
    }
    // now even the right key is denied for this IP
    expect(
      await tryAdminBootstrap(
        {
          url: url("?admin=hemmelig-n%C3%B8kkel"),
          cookies: c,
          clientAddress: "2.2.2.2",
        },
        env,
      ),
    ).toBe("denied");
    expect(c._sets).toHaveLength(0);
  });
  test("missing GALLERY_ADMIN_KEY → always denied", async () => {
    const c = jar();
    expect(
      await tryAdminBootstrap({ url: url("?admin=whatever"), cookies: c }, {
        SESSION_SECRET: "s",
      } as Env),
    ).toBe("denied");
  });
  test("?admin=logout clears the cookie", async () => {
    const c = jar({ [ADMIN_COOKIE_NAME]: generateAdminCookie(env) });
    expect(
      await tryAdminBootstrap({ url: url("?admin=logout"), cookies: c }, env),
    ).toBe("logout");
    expect(isGalleryAdmin(c, env)).toBe(false);
  });
});
