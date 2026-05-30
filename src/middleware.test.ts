import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock environment
const mockEnv = {
  SESSION_SECRET: "test-secret-key-12345",
  NOTION_API_KEY: "test-notion-key",
  NOTION_INVITES_DATABASE_ID: "test-invites-db",
  NOTION_FLAGS_DATABASE_ID: "test-flags-db",
};

// Mock cloudflare:workers
mock.module("cloudflare:workers", () => {
  return {
    env: mockEnv,
  };
});

// Mock astro:middleware
mock.module("astro:middleware", () => {
  return {
    defineMiddleware: (fn: any) => fn,
  };
});

// Mock notion client
let mockInviteCodeResponse: any = null;
let mockFlagsResponse: Array<{ key: string; enabled: boolean }> = [];

mock.module("@notionhq/client", () => {
  return {
    Client: class MockClient {
      databases = {
        retrieve: async ({ database_id }: { database_id: string }) => {
          return { data_sources: [{ id: `${database_id}-ds` }] };
        },
      };
      dataSources = {
        query: async ({ data_source_id }: { data_source_id: string }) => {
          if (data_source_id.includes("test-invites-db")) {
            if (mockInviteCodeResponse) {
              return { results: [mockInviteCodeResponse] };
            }
            return { results: [] };
          }
          if (data_source_id.includes("test-flags-db")) {
            const results = mockFlagsResponse.map((f) => ({
              properties: {
                Name: {
                  type: "title",
                  title: [{ plain_text: f.key }],
                },
                Aktivert: {
                  type: "select",
                  select: { name: f.enabled ? "Ja" : "Nei" },
                },
              },
            }));
            return { results };
          }
          return { results: [] };
        },
      };
      pages = {
        retrieve: async ({ page_id }: { page_id: string }) => {
          return { id: page_id, properties: {} };
        },
      };
    },
  };
});

// Import middleware and helpers dynamically
const { onRequest } = await import("./middleware");
const { generateSessionCookie, verifySessionCookie } = await import(
  "./services/pin"
);

function createMockContext(
  urlPath: string,
  cookies: Record<string, string> = {},
) {
  const url = new URL(urlPath, "https://andersogkristine.no");
  const cookieStore = new Map<string, string>(Object.entries(cookies));
  const setCalls: Array<[string, string, any]> = [];

  return {
    request: new Request(url.toString()),
    cookies: {
      get: (name: string) => {
        const val = cookieStore.get(name);
        return val ? { value: val } : undefined;
      },
      set: (name: string, value: string, options: any) => {
        cookieStore.set(name, value);
        setCalls.push([name, value, options]);
      },
      delete: (name: string) => {
        cookieStore.delete(name);
      },
      has: (name: string) => cookieStore.has(name),
    },
    locals: {
      runtime: {
        ctx: {
          waitUntil: () => {},
        },
      },
    },
    redirect: (redirectUrl: string) => {
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    },
    _setCalls: setCalls,
  };
}

describe("Astro Middleware & Invite Code Bypass", () => {
  beforeEach(() => {
    mockInviteCodeResponse = null;
    mockFlagsResponse = [
      { key: "rsvp", enabled: true },
      { key: "seating", enabled: true },
      { key: "music", enabled: true },
      { key: "map", enabled: true },
    ];
  });

  test("should pass through static assets without checks", async () => {
    const context = createMockContext("/favicon.svg");
    const nextCalled = mock(async () => new Response("OK"));

    const response = (await onRequest(context as any, nextCalled)) as Response;
    expect(await response.text()).toBe("OK");
    expect(nextCalled).toHaveBeenCalled();
  });

  test("should pass through PIN page and validate-pin API without checks", async () => {
    const pinContext = createMockContext("/pin");
    const pinNext = mock(async () => new Response("PIN_PAGE"));
    let response = (await onRequest(pinContext as any, pinNext)) as Response;
    expect(await response.text()).toBe("PIN_PAGE");
    expect(pinNext).toHaveBeenCalled();

    const apiContext = createMockContext("/api/validate-pin");
    const apiNext = mock(async () => new Response("API"));
    response = (await onRequest(apiContext as any, apiNext)) as Response;
    expect(await response.text()).toBe("API");
    expect(apiNext).toHaveBeenCalled();
  });

  test("should redirect unauthenticated users to /pin, preserving the next page", async () => {
    const context = createMockContext("/rsvp");
    const nextCalled = mock(async () => new Response("OK"));

    const response = (await onRequest(context as any, nextCalled)) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/pin?next=%2Frsvp");
    expect(nextCalled).not.toHaveBeenCalled();
  });

  test("should allow authenticated users to pass through without re-checking notion", async () => {
    const validCookie = generateSessionCookie(mockEnv as any);
    const context = createMockContext("/rsvp", { wedding_access: validCookie });
    const nextCalled = mock(async () => new Response("OK"));

    const response = (await onRequest(context as any, nextCalled)) as Response;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(nextCalled).toHaveBeenCalled();
  });

  test("should automatically log in a user with a valid invite code", async () => {
    mockInviteCodeResponse = {
      id: "invite-123",
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "Test Invite" }],
        },
        Kode: {
          type: "rich_text",
          rich_text: [{ plain_text: "secret-code" }],
        },
        "🧑‍🤝‍🧑 Gjester": {
          type: "relation",
          relation: [],
        },
      },
    };

    const context = createMockContext("/rsvp?code=secret-code");
    const nextCalled = mock(async () => new Response("OK"));

    const response = (await onRequest(context as any, nextCalled)) as Response;

    // It should set the cookie and call next()
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(nextCalled).toHaveBeenCalled();

    // Verify a cookie was set
    expect(context._setCalls.length).toBe(1);
    const [cookieName, cookieVal, options] = context._setCalls[0];
    expect(cookieName).toBe("wedding_access");
    expect(verifySessionCookie(cookieVal, mockEnv as any)).toBe(true);
    expect(options.path).toBe("/");
    expect(options.httpOnly).toBe(true);
  });

  test("should redirect to /pin with error if the invite code is invalid", async () => {
    mockInviteCodeResponse = null; // invalid code

    const context = createMockContext("/rsvp?code=invalid-code");
    const nextCalled = mock(async () => new Response("OK"));

    const response = (await onRequest(context as any, nextCalled)) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/pin?error=invalid_invite&next=%2Frsvp%3Fcode%3Dinvalid-code",
    );
    expect(nextCalled).not.toHaveBeenCalled();
    expect(context._setCalls.length).toBe(0);
  });

  describe("Feature Flags Blocking", () => {
    test("should allow accessing /rsvp if rsvp flag is enabled", async () => {
      mockFlagsResponse = [{ key: "rsvp", enabled: true }];
      const validCookie = generateSessionCookie(mockEnv as any);
      const context = createMockContext("/rsvp", {
        wedding_access: validCookie,
      });
      const nextCalled = mock(async () => new Response("RSVP_PAGE"));

      const response = (await onRequest(
        context as any,
        nextCalled,
      )) as Response;
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("RSVP_PAGE");
      expect(nextCalled).toHaveBeenCalled();
    });

    test("should redirect /rsvp to / if rsvp flag is disabled", async () => {
      mockFlagsResponse = [{ key: "rsvp", enabled: false }];
      const validCookie = generateSessionCookie(mockEnv as any);
      const context = createMockContext("/rsvp", {
        wedding_access: validCookie,
      });
      const nextCalled = mock(async () => new Response("RSVP_PAGE"));

      const response = (await onRequest(
        context as any,
        nextCalled,
      )) as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/");
      expect(nextCalled).not.toHaveBeenCalled();
    });

    test("should redirect /bordoppsett to / if seating flag is disabled", async () => {
      mockFlagsResponse = [{ key: "seating", enabled: false }];
      const validCookie = generateSessionCookie(mockEnv as any);
      const context = createMockContext("/bordoppsett", {
        wedding_access: validCookie,
      });
      const nextCalled = mock(async () => new Response("SEATING_PAGE"));

      const response = (await onRequest(
        context as any,
        nextCalled,
      )) as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/");
      expect(nextCalled).not.toHaveBeenCalled();
    });
  });
});
