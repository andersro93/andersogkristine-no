import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockEnv = {
  SESSION_SECRET: "test-secret-key-12345",
  NOTION_API_KEY: "test-notion-key",
  NOTION_INVITES_DATABASE_ID: "test-invites-db",
};

mock.module("cloudflare:workers", () => ({ env: mockEnv }));

// Track Notion writes
let updates: Array<{ page_id: string; properties: any }> = [];
const knownCode = "gyldig-kode";

mock.module("@notionhq/client", () => ({
  Client: class MockClient {
    databases = {
      retrieve: async ({ database_id }: { database_id: string }) => ({
        data_sources: [{ id: `${database_id}-ds` }],
      }),
    };
    dataSources = {
      query: async ({ filter }: { data_source_id: string; filter?: any }) => {
        const code = filter?.rich_text?.equals;
        if (code === knownCode) {
          return {
            results: [
              {
                id: "invite-1",
                properties: {
                  Name: { type: "title", title: [{ plain_text: "Fam. Test" }] },
                  Kode: {
                    type: "rich_text",
                    rich_text: [{ plain_text: code }],
                  },
                  "🧑‍🤝‍🧑 Gjester": {
                    type: "relation",
                    relation: [{ id: "guest-a" }, { id: "guest-b" }],
                  },
                },
              },
            ],
          };
        }
        return { results: [] };
      },
    };
    pages = {
      retrieve: async ({ page_id }: { page_id: string }) => ({
        id: page_id,
        properties: {
          Navn: { type: "title", title: [{ plain_text: page_id }] },
          RSVP: { type: "status", status: { name: "Venter" } },
          Allergener: {
            type: "multi_select",
            multi_select: [{ name: "Gluten" }, { name: "Egg" }],
          },
        },
      }),
      update: async (args: { page_id: string; properties: any }) => {
        updates.push(args);
        return {};
      },
    };
  },
}));

const { POST } = await import("../../pages/api/rsvp");
const { clearMemoryCache, MAX_ATTEMPTS } = await import("../../services/pin");
const { fetchInviteByCode } = await import("../../services/notion");

function ctx(body: unknown, ip = "203.0.113.7") {
  return {
    clientAddress: ip,
    request: new Request("https://andersogkristine.no/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    cookies: { get: () => undefined, set: () => {} },
    locals: {},
  } as any;
}

describe("POST /api/rsvp", () => {
  beforeEach(() => {
    updates = [];
    clearMemoryCache();
  });

  test("reads Allergener as a multi_select list", async () => {
    const invite = await fetchInviteByCode(knownCode, mockEnv as any);
    expect(invite?.guests[0].allergies).toEqual(["Gluten", "Egg"]);
  });

  test("writes multi_select for allowed guests and returns 200", async () => {
    const res = await POST(
      ctx({
        code: knownCode,
        guests: [
          { id: "guest-a", rsvp: "Kommer", allergies: ["Gluten", "Vegetar"] },
          { id: "guest-b", rsvp: "Kommer ikke", allergies: ["ignored"] },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(2);
    expect(updates[0].properties.Allergener).toEqual({
      multi_select: [{ name: "Gluten" }, { name: "Vegetar" }],
    });
    expect(updates[0].properties.RSVP).toEqual({ status: { name: "Kommer" } });
    expect(updates[1].properties.Allergener).toEqual({ multi_select: [] });
  });

  test("rejects missing code with 400 and writes nothing", async () => {
    const res = await POST(
      ctx({ guests: [{ id: "guest-a", rsvp: "Kommer" }] }),
    );
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  test("rejects unknown code with 403 and writes nothing", async () => {
    const res = await POST(
      ctx({ code: "feil-kode", guests: [{ id: "guest-a", rsvp: "Kommer" }] }),
    );
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  test("rejects guest ids outside the invite with 400 and writes nothing", async () => {
    const res = await POST(
      ctx({
        code: knownCode,
        guests: [
          { id: "guest-a", rsvp: "Kommer" },
          { id: "guest-of-someone-else", rsvp: "Kommer ikke" },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  test("rejects disallowed rsvp values with 400", async () => {
    const res = await POST(
      ctx({ code: knownCode, guests: [{ id: "guest-a", rsvp: "Venter" }] }),
    );
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  test("rate-limits repeated bad codes per IP with 429", async () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = await POST(
        ctx({ code: `gjett-${i}`, guests: [{ id: "x", rsvp: "Kommer" }] }, ip),
      );
      expect(r.status).toBe(403);
    }
    // Even a *valid* code is now blocked from this IP until the lockout expires
    const blocked = await POST(
      ctx({ code: knownCode, guests: [{ id: "guest-a", rsvp: "Kommer" }] }, ip),
    );
    expect(blocked.status).toBe(429);
    expect(updates).toHaveLength(0);
  });

  test("returns 400 on malformed JSON", async () => {
    const res = await POST(ctx("{not json"));
    expect(res.status).toBe(400);
  });
});
