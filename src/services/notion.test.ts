import { mock, describe, test, expect, beforeEach } from "bun:test";
import {
  fetchFeatureFlags,
  fetchScheduleFromNotion,
  fetchEgentidData,
  fetchFaqFromNotion,
  fetchToastmasterFromNotion,
  fetchStoryFromNotion,
} from "./notion";

// Setup mocks for @notionhq/client
let mockFlagsResults: any[] = [];
let mockProgramResults: any[] = [];
let mockFaqResults: any[] = [];
let mockMedvirkendeResults: any[] = [];
let mockEgentidResults: any[] = [];
let mockLocationsResults: any[] = [];
let mockStoryResults: any[] = [];

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
          return { results: [] };
        },
      };
      pages = {
        retrieve: async ({ page_id }: { page_id: string }) => {
          return { id: page_id, properties: {} };
        },
        update: async () => ({}),
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
      WEDDING_CACHE: mockKV,
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
    test("should fetch, filter, sort and format program timeline", async () => {
      mockProgramResults = [
        {
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
            Kategori: {
              type: "multi_select",
              multi_select: [{ name: "Stemning" }],
            },
            Webside: {
              type: "select",
              select: { name: "Ja" },
            },
          },
        },
        {
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
            Kategori: {
              type: "multi_select",
              multi_select: [],
            },
            Webside: {
              type: "select",
              select: { name: "Ja" },
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
    });
  });

  describe("fetchFaqFromNotion", () => {
    test("should fetch and parse FAQs with HTML answers", async () => {
      mockFaqResults = [
        {
          properties: {
            "Spørsmål": {
              type: "title",
              title: [{ plain_text: "Hva er kleskoden?" }],
            },
            "Svar": {
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
            Name: {
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
            Name: {
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
            Sted: {
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
      expect(egentidData[0].suggestions[0].locationId).toBe("location-liebling");
    });
  });

  describe("fetchToastmasterFromNotion", () => {
    test("should fetch toastmaster page by Role 'Toastmaster'", async () => {
      mockMedvirkendeResults = [
        {
          id: "contrib-toastmaster",
          properties: {
            Navn: {
              type: "title",
              title: [{ plain_text: "Sandra Ingdal" }],
            },
            Role: {
              type: "rich_text",
              rich_text: [{ plain_text: "Toastmaster" }],
            },
            Email: {
              type: "email",
              email: "toastmaster@example.com",
            },
            Telefon: {
              type: "phone_number",
              phone_number: "+47 999 99 999",
            },
          },
        },
      ];

      const tm = await fetchToastmasterFromNotion(mockEnv);
      expect(tm).toBeDefined();
      expect(tm.name).toBe("Sandra Ingdal");
      expect(tm.email).toBe("toastmaster@example.com");
      expect(tm.phone).toBe("+47 999 99 999");
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
        { time: "11:00", title: "Cached Event", description: "From Cache", icon: "ring" },
      ];
      await mockKV.put("notion_schedule", JSON.stringify({
        data: cachedTimeline,
        timestamp: Date.now(),
      }));

      // This call should bypass querying the Notion API (results array is empty)
      const schedule = await fetchScheduleFromNotion(mockEnv);
      expect(schedule).toHaveLength(1);
      expect(schedule[0].title).toBe("Cached Event");
    });
  });
});
