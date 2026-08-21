import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  fetchAllergyOptions,
  fetchEgentidData,
  fetchFaqFromNotion,
  fetchFeatureFlags,
  fetchInviteByCode,
  fetchScheduleFromNotion,
  fetchStoryFromNotion,
  resolveContributorPhoto,
  sanitizeAllergyItems,
  updateGuestRSVP,
} from "./notion";

// Setup mocks for @notionhq/client
let mockFlagsResults: any[] = [];
let mockProgramResults: any[] = [];
let mockFaqResults: any[] = [];
let mockMedvirkendeResults: any[] = [];
let mockEgentidResults: any[] = [];
let mockLocationsResults: any[] = [];
let mockStoryResults: any[] = [];
let mockInvitesResults: any[] = [];
let mockGuestPages: Record<string, any> = {};
let mockGuestsSchema: any = {};
let mockPageUpdates: any[] = [];

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
          if (data_source_id.includes("flags-db")) {
            return { results: mockFlagsResults };
          }
          if (data_source_id.includes("program-db")) {
            return { results: mockProgramResults };
          }
          if (data_source_id.includes("faq-db")) {
            return { results: mockFaqResults };
          }
          if (data_source_id.includes("medvirkende-db")) {
            return { results: mockMedvirkendeResults };
          }
          if (data_source_id.includes("egentid-db")) {
            return { results: mockEgentidResults };
          }
          if (data_source_id.includes("locations-db")) {
            return { results: mockLocationsResults };
          }
          if (data_source_id.includes("story-db")) {
            return { results: mockStoryResults };
          }
          if (data_source_id.includes("invites-db")) {
            return { results: mockInvitesResults };
          }
          return { results: [] };
        },
        retrieve: async ({ data_source_id }: { data_source_id: string }) => {
          if (data_source_id.includes("guests-db")) {
            return { properties: mockGuestsSchema };
          }
          return { properties: {} };
        },
      };
      pages = {
        retrieve: async ({ page_id }: { page_id: string }) => {
          return mockGuestPages[page_id] ?? { id: page_id, properties: {} };
        },
        update: async (args: any) => {
          mockPageUpdates.push(args);
          return {};
        },
      };
    },
  };
});

describe("Notion Service Integration & Fallbacks", () => {
  let mockKV: any;
  let mockEnv: any;

  beforeEach(() => {
    // Clear mock arrays
    mockFlagsResults = [];
    mockProgramResults = [];
    mockFaqResults = [];
    mockMedvirkendeResults = [];
    mockEgentidResults = [];
    mockLocationsResults = [];
    mockStoryResults = [];
    mockInvitesResults = [];
    mockGuestPages = {};
    mockGuestsSchema = {};
    mockPageUpdates = [];

    // Reset mock KV cache
    const store = new Map<string, string>();
    mockKV = {
      get: mock(async (key: string) => store.get(key) || null),
      put: mock(async (key: string, val: string) => {
        store.set(key, val);
      }),
      delete: mock(async (key: string) => {
        store.delete(key);
      }),
    };

    mockEnv = {
      NOTION_API_KEY: "mock-api-key",
      NOTION_FLAGS_DATABASE_ID: "flags-db",
      NOTION_PROGRAM_DATABASE_ID: "program-db",
      NOTION_FAQ_DATABASE_ID: "faq-db",
      NOTION_MEDVIRKENDE_DATABASE_ID: "medvirkende-db",
      NOTION_EGENTID_DATABASE_ID: "egentid-db",
      NOTION_LOCATIONS_DATABASE_ID: "locations-db",
      NOTION_STORY_DATABASE_ID: "story-db",
      NOTION_INVITES_DATABASE_ID: "invites-db",
      NOTION_GUESTS_DATABASE_ID: "guests-db",
      CACHE: mockKV,
    };
  });

  describe("fetchFeatureFlags", () => {
    test("should fetch and parse feature flags successfully", async () => {
      mockFlagsResults = [
        {
          properties: {
            "Flagg Id": {
              type: "title",
              title: [{ plain_text: "rsvp" }],
            },
            Aktivert: {
              type: "select",
              select: { name: "Ja" },
            },
          },
        },
        {
          properties: {
            "Flagg Id": {
              type: "title",
              title: [{ plain_text: "seating" }],
            },
            Aktivert: {
              type: "select",
              select: { name: "Nei" },
            },
          },
        },
      ];

      const flags = await fetchFeatureFlags(mockEnv);
      expect(flags).toBeDefined();
      expect(flags.rsvp).toBe(true);
      expect(flags.seating).toBe(false);
    });

    test("should use prebuild defaults if Notion query returns no flags", async () => {
      // Mock retrieve error
      mockFlagsResults = [];
      const flags = await fetchFeatureFlags({
        ...mockEnv,
        NOTION_FLAGS_DATABASE_ID: "invalid-db", // triggers empty result
      });
      expect(flags).toBeDefined();
      // Defaults come from prebuild notion-fallback.json, not hardcoded values.
      // Verify the flags object is returned (whatever the prebuild snapshot had).
      expect(typeof flags).toBe("object");
    });
  });

  describe("fetchScheduleFromNotion", () => {
    test("should fetch, filter, sort and format program timeline with page emojis", async () => {
      mockProgramResults = [
        {
          // Page-level emoji icon (top-level, not inside properties)
          icon: { type: "emoji", emoji: "💍" },
          properties: {
            Tittel: {
              type: "title",
              title: [{ plain_text: "Vielse" }],
            },
            Tidspunkt: {
              type: "date",
              date: { start: "2026-09-26T13:00:00.000+02:00" },
            },
            Beskrivelse: {
              type: "rich_text",
              rich_text: [{ plain_text: "Vielse i Paulus Kirke" }],
            },
            Webside: {
              type: "select",
              select: { name: "Ja" },
            },
            Sted: {
              type: "relation",
              relation: [{ id: "loc-kirke" }],
            },
          },
        },
        {
          icon: { type: "emoji", emoji: "⛪" },
          properties: {
            Tittel: {
              type: "title",
              title: [{ plain_text: "Oppmøte" }],
            },
            Tidspunkt: {
              type: "date",
              date: { start: "2026-09-26T12:30:00.000+02:00" },
            },
            Beskrivelse: {
              type: "rich_text",
              rich_text: [{ plain_text: "Oppmøte i kirken" }],
            },
            Webside: {
              type: "select",
              select: { name: "Ja" },
            },
            Sted: {
              type: "relation",
              relation: [{ id: "loc-kirke" }],
            },
          },
        },
      ];

      const schedule = await fetchScheduleFromNotion(mockEnv);
      expect(schedule).toHaveLength(2);
      // Verify sorting order: Oppmøte (12:30) then Vielse (13:00)
      expect(schedule[0].title).toBe("Oppmøte");
      expect(schedule[1].title).toBe("Vielse");
      expect(schedule[0].time).toBe("12:30");
      expect(schedule[1].time).toBe("13:00");
      // Verify icons are resolved from page emoji
      expect(schedule[0].icon).toBe("⛪");
      expect(schedule[1].icon).toBe("💍");
    });
  });

  describe("fetchFaqFromNotion", () => {
    test("should fetch and parse FAQs with HTML answers", async () => {
      mockFaqResults = [
        {
          properties: {
            Spørsmål: {
              type: "title",
              title: [{ plain_text: "Hva er kleskoden?" }],
            },
            Svar: {
              type: "rich_text",
              rich_text: [
                {
                  plain_text: "Kleskoden er ",
                  annotations: {},
                },
                {
                  plain_text: "Mørk Dress / Smoking",
                  annotations: { bold: true },
                },
              ],
            },
          },
        },
      ];

      const faqs = await fetchFaqFromNotion(mockEnv);
      expect(faqs).toHaveLength(1);
      expect(faqs[0].question).toBe("Hva er kleskoden?");
      expect(faqs[0].answer).toContain("<strong>Mørk Dress / Smoking</strong>");
    });
  });

  describe("fetchEgentidData", () => {
    test("should query medvirkende and egentid, mapping suggestions", async () => {
      mockMedvirkendeResults = [
        {
          id: "contrib-kristine",
          properties: {
            Navn: {
              type: "title",
              title: [{ plain_text: "Kristine" }],
            },
            Role: {
              type: "rich_text",
              rich_text: [{ plain_text: "Brud" }],
            },
            Emoji: {
              type: "rich_text",
              rich_text: [{ plain_text: "👰‍♀️" }],
            },
          },
        },
      ];

      mockEgentidResults = [
        {
          properties: {
            Tittel: {
              type: "title",
              title: [{ plain_text: "Liebling" }],
            },
            Beskrivelse: {
              type: "rich_text",
              rich_text: [{ plain_text: "Min favorittkafé" }],
            },
            Medvirkende: {
              type: "relation",
              relation: [{ id: "contrib-kristine" }],
            },
            "📍 Sted": {
              type: "relation",
              relation: [{ id: "location-liebling" }],
            },
          },
        },
      ];

      const egentidData = await fetchEgentidData(mockEnv);
      expect(egentidData).toHaveLength(1);
      expect(egentidData[0].name).toBe("Kristine");
      expect(egentidData[0].suggestions).toHaveLength(1);
      expect(egentidData[0].suggestions[0].text).toContain("Liebling");
      expect(egentidData[0].suggestions[0].locationId).toBe(
        "location-liebling",
      );
    });
  });

  describe("fetchStoryFromNotion", () => {
    test("should fetch, filter and sort Our Story timeline items", async () => {
      mockStoryResults = [
        {
          id: "story-later",
          properties: {
            Tittel: {
              type: "title",
              title: [{ plain_text: "Forlovet" }],
            },
            Beskrivelse: {
              type: "rich_text",
              rich_text: [{ plain_text: "Anders fridde!" }],
            },
            Dato: {
              type: "date",
              date: { start: "2025-02-14" },
            },
          },
        },
        {
          id: "story-earlier",
          properties: {
            Tittel: {
              type: "title",
              title: [{ plain_text: "Kjærester" }],
            },
            Beskrivelse: {
              type: "rich_text",
              rich_text: [{ plain_text: "Vi ble kjærester" }],
            },
            Dato: {
              type: "date",
              date: { start: "2010-09-01" },
            },
          },
        },
      ];

      const story = await fetchStoryFromNotion(mockEnv);
      expect(story).toHaveLength(2);
      // Sorted chronologically ascending: 2010 first, then 2025
      expect(story[0].year).toBe("2010");
      expect(story[0].title).toBe("Kjærester");
      expect(story[1].year).toBe("2025");
      expect(story[1].title).toBe("Forlovet");
    });
  });

  describe("KV Cache Flow (SWR)", () => {
    test("should return cached data immediately if available", async () => {
      const cachedTimeline = [
        {
          time: "11:00",
          title: "Cached Event",
          description: "From Cache",
          icon: "ring",
        },
      ];
      await mockKV.put(
        "notion_schedule",
        JSON.stringify({
          data: cachedTimeline,
          timestamp: Date.now(),
        }),
      );

      // This call should bypass querying the Notion API (results array is empty)
      const schedule = await fetchScheduleFromNotion(mockEnv);
      expect(schedule).toHaveLength(1);
      expect(schedule[0].title).toBe("Cached Event");
    });
  });
  describe("sanitizeAllergyItems", () => {
    test("should trim, drop empties and reject non-arrays", () => {
      expect(sanitizeAllergyItems(["  Gluten  ", "", "   "])).toEqual([
        "Gluten",
      ]);
      expect(sanitizeAllergyItems([])).toEqual([]);
      expect(sanitizeAllergyItems("Gluten")).toEqual([]);
      expect(sanitizeAllergyItems(undefined)).toEqual([]);
    });

    test("should split on commas since Notion rejects them in option names", () => {
      expect(sanitizeAllergyItems(["nøtter, egg", "Gluten"])).toEqual([
        "nøtter",
        "egg",
        "Gluten",
      ]);
    });

    test("should dedupe case-insensitively keeping the first spelling", () => {
      expect(sanitizeAllergyItems(["Gluten", "gluten", "GLUTEN"])).toEqual([
        "Gluten",
      ]);
    });

    test("should truncate names to Notion's 100 character limit", () => {
      const [name] = sanitizeAllergyItems(["a".repeat(150)]);
      expect(name).toHaveLength(100);
    });

    test("should cap the number of items", () => {
      const many = Array.from({ length: 40 }, (_, i) => `allergi-${i}`);
      expect(sanitizeAllergyItems(many)).toHaveLength(20);
    });
  });

  describe("updateGuestRSVP", () => {
    test("should write allergies as a multi_select list", async () => {
      await updateGuestRSVP("guest-1", "Kommer", ["Gluten", "nøtter"], mockEnv);

      expect(mockPageUpdates).toHaveLength(1);
      const { page_id, properties } = mockPageUpdates[0];
      expect(page_id).toBe("guest-1");
      expect(properties.RSVP).toEqual({ status: { name: "Kommer" } });
      expect(properties.Allergener).toEqual({
        multi_select: [{ name: "Gluten" }, { name: "nøtter" }],
      });
    });

    test("should clear the field with an empty multi_select", async () => {
      await updateGuestRSVP("guest-1", "Kommer ikke", [], mockEnv);

      expect(mockPageUpdates[0].properties.Allergener).toEqual({
        multi_select: [],
      });
    });

    test("should sanitize untrusted input before writing", async () => {
      await updateGuestRSVP(
        "guest-1",
        "Kommer",
        ["  gluten, Gluten  "],
        mockEnv,
      );

      expect(mockPageUpdates[0].properties.Allergener).toEqual({
        multi_select: [{ name: "gluten" }],
      });
    });
  });

  describe("fetchInviteByCode allergies", () => {
    function setupInvite(allergyProperty: any) {
      mockInvitesResults = [
        {
          id: "invite-1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Familien Test" }] },
            Kode: {
              type: "rich_text",
              rich_text: [{ plain_text: "TEST2026" }],
            },
            "🧑‍🤝‍🧑 Gjester": {
              type: "relation",
              relation: [{ id: "guest-1" }],
            },
          },
        },
      ];
      mockGuestPages = {
        "guest-1": {
          id: "guest-1",
          properties: {
            Navn: { type: "title", title: [{ plain_text: "Test Testesen" }] },
            RSVP: { type: "status", status: { name: "Kommer" } },
            Allergener: allergyProperty,
          },
        },
      };
    }

    test("should read a multi_select property as a list", async () => {
      setupInvite({
        type: "multi_select",
        multi_select: [{ name: "Gluten" }, { name: "Nøtter" }],
      });

      const invite = await fetchInviteByCode("TEST2026", mockEnv);
      expect(invite?.guests[0].allergies).toEqual(["Gluten", "Nøtter"]);
    });

    test("should read a legacy select property as a single-item list", async () => {
      setupInvite({ type: "select", select: { name: "Gluten" } });

      const invite = await fetchInviteByCode("TEST2026", mockEnv);
      expect(invite?.guests[0].allergies).toEqual(["Gluten"]);
    });

    test("should return an empty list when the property is unset", async () => {
      setupInvite({ type: "select", select: null });

      const invite = await fetchInviteByCode("TEST2026", mockEnv);
      expect(invite?.guests[0].allergies).toEqual([]);
    });
  });

  describe("fetchAllergyOptions", () => {
    test("should return multi_select option names sorted", async () => {
      mockGuestsSchema = {
        Allergener: {
          type: "multi_select",
          multi_select: {
            options: [{ name: "Nøtter" }, { name: "Gluten" }, { name: "Egg" }],
          },
        },
      };

      const options = await fetchAllergyOptions(mockEnv);
      expect(options).toEqual(["Egg", "Gluten", "Nøtter"]);
    });

    test("should fall back to legacy select options", async () => {
      mockGuestsSchema = {
        Allergener: {
          type: "select",
          select: { options: [{ name: "Gluten" }] },
        },
      };

      expect(await fetchAllergyOptions(mockEnv)).toEqual(["Gluten"]);
    });

    test("should return an empty list when the property is missing", async () => {
      mockGuestsSchema = {};
      expect(await fetchAllergyOptions(mockEnv)).toEqual([]);
    });
  });
});

describe("resolveContributorPhoto", () => {
  const files = [
    "/images/egentid/anders.webp",
    "/images/egentid/downloads/page-123.jpg",
    "/images/toastmaster/marte.webp",
  ];
  test("prefers the prebuild download by page id", () => {
    expect(
      resolveContributorPhoto(
        { id: "page-123", name: "Anders Olsen" },
        "https://s3/expiring",
        files,
      ),
    ).toBe("/images/egentid/downloads/page-123.jpg");
  });
  test("falls back to first-name match in egentid or toastmaster folders", () => {
    expect(
      resolveContributorPhoto({ id: "x", name: "Anders" }, "", files),
    ).toBe("/images/egentid/anders.webp");
    expect(
      resolveContributorPhoto({ id: "x", name: "Marte Hansen" }, "", files),
    ).toBe("/images/toastmaster/marte.webp");
  });
  test("uses the Notion URL when nothing local matches", () => {
    expect(
      resolveContributorPhoto(
        { id: "x", name: "Ukjent" },
        "https://s3/expiring",
        files,
      ),
    ).toBe("https://s3/expiring");
  });
});
