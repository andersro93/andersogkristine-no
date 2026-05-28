import type { Env } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import type { PageObjectResponse } from "@notionhq/client";
import { Client } from "@notionhq/client";
import { notionConfig } from "../config/notion";

// Helper interfaces for Notion API JSON properties
interface NotionRichTextItem {
  plain_text: string;
}

interface NotionSelectItem {
  name: string;
}

// Cache for Data Source IDs in memory to avoid repeated metadata queries
const dataSourceIdCache = new Map<string, string>();

async function getDataSourceId(
  notion: Client,
  databaseId: string,
): Promise<string> {
  if (dataSourceIdCache.has(databaseId)) {
    return dataSourceIdCache.get(databaseId) as string;
  }

  console.log(`Resolving data source ID for database: ${databaseId}`);
  const db = await notion.databases.retrieve({ database_id: databaseId });
  if ("data_sources" in db && db.data_sources && db.data_sources.length > 0) {
    const dsId = db.data_sources[0].id;
    dataSourceIdCache.set(databaseId, dsId);
    return dsId;
  }
  throw new Error(`No data source found for database container: ${databaseId}`);
}

// Helper to get Notion client based on environment
export function getNotionClient(localEnv?: Env) {
  // Use the passed env, or fallback to the imported cloudflare workers env, or fallback to process.env in local CLI environments
  const apiKey =
    localEnv?.NOTION_API_KEY ||
    env?.NOTION_API_KEY ||
    process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NOTION_API_KEY is not defined. Please add it to your .env file or Cloudflare environment variables.",
    );
  }
  return new Client({
    auth: apiKey,
    notionVersion: "2025-09-03",
  });
}

export interface Guest {
  id: string;
  name: string;
  rsvp: string; // "Venter" | "Kommer" | "Kommer ikke"
  allergies: string;
  tableId?: string | null;
  tableName?: string | null;
}

export interface Invite {
  id: string;
  code: string;
  name: string;
  guests: Guest[];
}

// 1. Fetch Invite by Code
export async function fetchInviteByCode(
  code: string,
  localEnv?: Env,
): Promise<Invite | null> {
  const notion = getNotionClient(localEnv);

  try {
    const invitesDsId = await getDataSourceId(
      notion,
      notionConfig.databases.invitesId,
    );

    // Query Invites database for matching code
    const invitesResponse = await notion.dataSources.query({
      data_source_id: invitesDsId,
      filter: {
        property: notionConfig.mappings.invites.code,
        rich_text: {
          equals: code.trim(),
        },
      },
    });

    if (invitesResponse.results.length === 0) {
      return null;
    }

    const invitePage = invitesResponse.results[0];
    if (!("properties" in invitePage)) {
      return null;
    }

    // Get basic invite details
    const nameProp = invitePage.properties[notionConfig.mappings.invites.name];
    const inviteName =
      nameProp?.type === "title"
        ? nameProp.title?.[0]?.plain_text || "Invitasjon"
        : "Invitasjon";

    const codeProp = invitePage.properties[notionConfig.mappings.invites.code];
    const inviteCode =
      codeProp?.type === "rich_text"
        ? codeProp.rich_text?.[0]?.plain_text || ""
        : "";

    // Fetch related guests
    const guestsRelation =
      invitePage.properties[notionConfig.mappings.invites.guests];
    const guestIds: string[] = [];
    if (guestsRelation?.type === "relation" && guestsRelation.relation) {
      guestIds.push(...guestsRelation.relation.map((r) => r.id));
    }

    // Fetch each guest in parallel
    const guests: Guest[] = [];
    if (guestIds.length > 0) {
      const guestPromises = guestIds.map(async (id) => {
        try {
          const guestPage = await notion.pages.retrieve({ page_id: id });
          if ("properties" in guestPage) {
            const guestNameProp =
              guestPage.properties[notionConfig.mappings.guests.name];
            const guestName =
              guestNameProp?.type === "title"
                ? guestNameProp.title?.[0]?.plain_text || ""
                : "";

            const guestRsvpProp =
              guestPage.properties[notionConfig.mappings.guests.rsvp];
            const guestRsvp =
              guestRsvpProp?.type === "status"
                ? guestRsvpProp.status?.name || notionConfig.rsvpStatus.pending
                : notionConfig.rsvpStatus.pending;

            const guestAllergiesProp =
              guestPage.properties[notionConfig.mappings.guests.allergies];
            const guestAllergies =
              guestAllergiesProp?.type === "select"
                ? guestAllergiesProp.select?.name || ""
                : "";

            const guestTableProp =
              guestPage.properties[notionConfig.mappings.guests.table];
            const guestTableId =
              (guestTableProp?.type === "relation" &&
                guestTableProp.relation?.[0]?.id) ||
              null;

            return {
              id: guestPage.id,
              name: guestName,
              rsvp: guestRsvp,
              allergies: guestAllergies,
              tableId: guestTableId,
            } as Guest;
          }
        } catch (err) {
          console.error(`Error fetching guest ${id}:`, err);
        }
        return null;
      });

      const guestResults = await Promise.all(guestPromises);
      guests.push(...(guestResults.filter(Boolean) as Guest[]));
    }

    return {
      id: invitePage.id,
      code: inviteCode,
      name: inviteName,
      guests,
    };
  } catch (error) {
    console.error("Error in fetchInviteByCode:", error);
    throw error;
  }
}

// 2. Update Guest RSVP & Allergies
export async function updateGuestRSVP(
  guestId: string,
  rsvp: string,
  allergies: string,
  comment?: string,
  localEnv?: Env,
): Promise<void> {
  const notion = getNotionClient(localEnv);

  try {
    const properties: Record<string, unknown> = {
      [notionConfig.mappings.guests.rsvp]: {
        status: {
          name: rsvp,
        },
      },
      [notionConfig.mappings.guests.allergies]: allergies.trim()
        ? { select: { name: allergies.trim() } }
        : { select: null },
    };

    // Try to update comments (song requests/messages) if they added a Kommentar field.
    // We use a safe try-catch so it won't crash if they don't have the column in their Notion table.
    if (comment?.trim()) {
      properties.Kommentar = {
        rich_text: [
          {
            text: {
              content: comment.trim(),
            },
          },
        ],
      };
    }

    await notion.pages.update({
      page_id: guestId,
      properties,
    });
  } catch (error) {
    console.error(`Error updating guest RSVP for ${guestId}:`, error);
    // If it failed because of "Kommentar" property (e.g. doesn't exist), retry without it
    if (
      comment &&
      error instanceof Error &&
      error.message.includes("Kommentar")
    ) {
      console.log("Retrying update without 'Kommentar' column...");
      const propertiesRetry: Record<string, unknown> = {
        [notionConfig.mappings.guests.rsvp]: {
          status: {
            name: rsvp,
          },
        },
        [notionConfig.mappings.guests.allergies]: allergies.trim()
          ? { select: { name: allergies.trim() } }
          : { select: null },
      };
      await notion.pages.update({
        page_id: guestId,
        properties: propertiesRetry,
      });
    } else {
      throw error;
    }
  }
}

// 3. Fetch All Seating Data (for Tables and Seating Chart)
export interface TableWithGuests {
  id: string;
  name: string;
  guests: {
    id: string;
    name: string;
  }[];
}

export async function fetchAllSeatingData(
  localEnv?: Env,
): Promise<TableWithGuests[]> {
  const notion = getNotionClient(localEnv);

  try {
    const tablesDsId = await getDataSourceId(
      notion,
      notionConfig.databases.tablesId,
    );

    // A. Query all tables
    const tablesResponse = await notion.dataSources.query({
      data_source_id: tablesDsId,
    });

    const tablesMap = new Map<string, TableWithGuests>();

    for (const page of tablesResponse.results) {
      if ("properties" in page) {
        const nameProp = page.properties[notionConfig.mappings.tables.name];
        const tableName =
          nameProp?.type === "title"
            ? nameProp.title?.[0]?.plain_text || "Bord"
            : "Bord";

        tablesMap.set(page.id, {
          id: page.id,
          name: tableName,
          guests: [],
        });
      }
    }

    const guestsDsId = await getDataSourceId(
      notion,
      notionConfig.databases.guestsId,
    );

    // B. Query all attending guests
    const guestsResponse = await notion.dataSources.query({
      data_source_id: guestsDsId,
      filter: {
        property: notionConfig.mappings.guests.rsvp,
        status: {
          equals: notionConfig.rsvpStatus.attending, // Only pull guests who are attending
        },
      },
      page_size: 100, // Adjust as necessary
    });

    // C. Map guests to their respective tables
    for (const page of guestsResponse.results) {
      if ("properties" in page) {
        const nameProp = page.properties[notionConfig.mappings.guests.name];
        const guestName =
          nameProp?.type === "title"
            ? nameProp.title?.[0]?.plain_text || ""
            : "";

        const tableProp = page.properties[notionConfig.mappings.guests.table];
        if (
          tableProp?.type === "relation" &&
          tableProp.relation &&
          tableProp.relation.length > 0
        ) {
          const tableId = tableProp.relation[0].id;
          const table = tablesMap.get(tableId);
          if (table) {
            table.guests.push({
              id: page.id,
              name: guestName,
            });
          }
        }
      }
    }

    // Sort guests alphabetically within each table so seating layout looks neat and searchable
    const tables = Array.from(tablesMap.values());
    for (const table of tables) {
      table.guests.sort((a, b) => a.name.localeCompare(b.name, "nb"));
    }

    // Sort tables by name (e.g. Bord 1, Bord 2...)
    tables.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    return tables;
  } catch (error) {
    console.error("Error in fetchAllSeatingData:", error);
    throw error;
  }
}

export interface ScheduleEvent {
  time: string;
  title: string;
  description: string;
  icon: string;
}

/**
 * Retrieves the wedding schedule timeline from the Notion program database,
 * cached in Cloudflare KV with Stale-While-Revalidate (SWR) logic.
 */
export async function fetchScheduleFromNotion(
  localEnv?: Env,
  context?: ExecutionContext,
): Promise<ScheduleEvent[]> {
  const currentEnv = localEnv || env;
  const kv = currentEnv?.WEDDING_CACHE;
  const cacheKey = "notion_schedule";

  // 1. Try to read from KV cache
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;

        // If cache is stale (> 1 minute), trigger background update (SWR)
        if (age > 60 * 1000) {
          console.log(
            `Schedule cache is stale (${Math.round(age / 1000)}s), triggering background refresh...`,
          );
          const updatePromise = updateScheduleCache(currentEnv).catch((err) => {
            console.error("Error in background schedule sync:", err);
          });

          // If running under Cloudflare Workers, register the background promise
          if (context?.waitUntil) {
            context.waitUntil(updatePromise);
          }
        }

        return data;
      }
    } catch (err) {
      console.error("KV read error for Notion schedule:", err);
    }
  }

  // 2. Cache miss: Fetch and update synchronously
  console.log("Schedule cache miss, performing synchronous fetch...");
  return await updateScheduleCache(currentEnv);
}

interface RawScheduleEvent {
  title: string;
  timeIso: string | null;
  description: string;
  categories: string[];
}

async function updateScheduleCache(localEnv?: Env): Promise<ScheduleEvent[]> {
  const currentEnv = localEnv || env;
  const notion = getNotionClient(currentEnv);
  const kv = currentEnv?.WEDDING_CACHE;
  const cacheKey = "notion_schedule";

  const programDbId =
    currentEnv?.NOTION_PROGRAM_DATABASE_ID ||
    process.env.NOTION_PROGRAM_DATABASE_ID ||
    notionConfig.databases.programId;
  if (!programDbId) {
    throw new Error("NOTION_PROGRAM_DATABASE_ID is not configured.");
  }

  const programDsId = await getDataSourceId(notion, programDbId);

  // Query database: Webside = Ja AND Hvem contains Gjester
  const response = await notion.dataSources.query({
    data_source_id: programDsId,
    filter: {
      and: [
        {
          property: "Webside",
          select: {
            equals: "Ja",
          },
        },
        {
          property: "Hvem",
          multi_select: {
            contains: "Gjester",
          },
        },
      ],
    },
  });

  const rawEvents = (response.results as PageObjectResponse[])
    .filter((page): page is PageObjectResponse => "properties" in page)
    .map((page): RawScheduleEvent => {
      const props = page.properties;

      // Title
      const title =
        props.Tittel?.type === "title"
          ? props.Tittel.title?.[0]?.plain_text || "Uten tittel"
          : "Uten tittel";

      // Time ISO (for sorting)
      const dateProp = props.Tidspunkt;
      const timeIso =
        dateProp?.type === "date" && dateProp.date?.start
          ? dateProp.date.start
          : null;

      // Description (safe fallback to multiple possible names)
      const descProp =
        props.Beskrivelse ||
        props.beskrivelse ||
        props.description ||
        props.Info ||
        props.Detaljer;
      let description = "";
      if (descProp?.type === "rich_text" && descProp.rich_text) {
        description = (descProp.rich_text as NotionRichTextItem[])
          .map((t) => t.plain_text)
          .join("");
      }

      // Categories
      const catProp = props.Kategori;
      const categories: string[] =
        catProp?.type === "multi_select"
          ? (catProp.multi_select as NotionSelectItem[]).map((s) => s.name)
          : [];

      return {
        title,
        timeIso,
        description,
        categories,
      };
    })
    // Filter out items with no start time
    .filter(
      (e): e is RawScheduleEvent & { timeIso: string } => e.timeIso !== null,
    );

  // Sort rawEvents ascending by raw ISO time first
  rawEvents.sort(
    (a, b) => new Date(a.timeIso).getTime() - new Date(b.timeIso).getTime(),
  );

  // Map to formattedEvents
  const formattedEvents: ScheduleEvent[] = rawEvents.map((e) => {
    // Format start time to HH:MM in Europe/Oslo timezone
    const date = new Date(e.timeIso);
    const time = new Intl.DateTimeFormat("no-NB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Oslo",
    }).format(date);

    // Map categories/titles to icons
    const icon = getIconForEvent(e.title, e.categories);

    return {
      time,
      title: e.title,
      description: e.description,
      icon,
    };
  });

  // Save to KV cache with current timestamp
  if (kv) {
    try {
      const cacheValue = JSON.stringify({
        data: formattedEvents,
        timestamp: Date.now(),
      });
      await kv.put(cacheKey, cacheValue);
      console.log("Notion schedule cache updated successfully.");
    } catch (err) {
      console.error("KV write error for Notion schedule:", err);
    }
  }

  return formattedEvents;
}

function getIconForEvent(title: string, categories: string[]): string {
  const lowerTitle = title.toLowerCase();

  if (lowerTitle.includes("vielse") || lowerTitle.includes("paulus kirke")) {
    return "ring";
  }
  if (lowerTitle.includes("kirke") || lowerTitle.includes("oppmøte")) {
    return "church";
  }
  if (lowerTitle.includes("foto") || lowerTitle.includes("bilde")) {
    return "camera";
  }
  if (lowerTitle.includes("egentid") || lowerTitle.includes("fritid")) {
    return "social";
  }
  if (
    lowerTitle.includes("kake") ||
    lowerTitle.includes("dessert") ||
    lowerTitle.includes("kaffe")
  ) {
    return "cake";
  }
  if (
    lowerTitle.includes("senga") ||
    lowerTitle.includes("avslutt") ||
    lowerTitle.includes("hjem")
  ) {
    return "sleep";
  }
  if (
    lowerTitle.includes("siste bestilling") ||
    lowerTitle.includes("stenge")
  ) {
    return "bell";
  }

  // Map based on categories
  if (categories.includes("Mat")) {
    return "food";
  }
  if (categories.includes("Drikke")) {
    return "glass";
  }
  if (categories.includes("Stemning") || categories.includes("Fest")) {
    return "music";
  }

  return "default";
}

export interface WeddingLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  googleMapsUrl?: string;
  ikon?: string;
}

const fallbackLocations: WeddingLocation[] = [
  {
    id: "36e8d369-6e2d-80ea-a58b-c8ec89631674",
    name: "Grünerløkka Brygghus",
    lat: 59.9247286,
    lng: 10.7584671,
    googleMapsUrl: "https://maps.app.goo.gl/sZgdXD9jp9rcmrHM9",
    ikon: "food",
  },
  {
    id: "36e8d369-6e2d-8014-ba64-ffe2a573905e",
    name: "Olaf Ryes Plass",
    lat: 59.9229316,
    lng: 10.7562115,
    googleMapsUrl: "https://maps.app.goo.gl/vw3p4JifncSofxzu8",
    ikon: "park",
  },
  {
    id: "36e8d369-6e2d-80e8-a5aa-f89b6a981a22",
    name: "Hotell 33",
    lat: 59.9291749,
    lng: 10.817278,
    googleMapsUrl: "https://maps.app.goo.gl/TWDf2sCnDdsE6F7e7",
    ikon: "hotel",
  },
  {
    id: "36e8d369-6e2d-8001-8b91-ef8da8a27448",
    name: "Sofienbergparken",
    lat: 59.9231031,
    lng: 10.7609634,
    googleMapsUrl: "https://maps.app.goo.gl/b2xU7SC8NjyD6i8L9",
    ikon: "park",
  },
  {
    id: "36e8d369-6e2d-8076-a00f-ca4867992ce0",
    name: "Botanisk Hage",
    lat: 59.9178158,
    lng: 10.7579778,
    googleMapsUrl: "https://maps.app.goo.gl/SysAjV5yeECwq4QG7",
    ikon: "park",
  },
  {
    id: "36e8d369-6e2d-808d-a2cd-fff18e7bc24f",
    name: "Birkelunden",
    lat: 59.9263636,
    lng: 10.7560554,
    googleMapsUrl: "https://maps.app.goo.gl/w8VTAFnS1H9qELJDA",
    ikon: "park",
  },
  {
    id: "36e8d369-6e2d-80d0-aa80-ed997494bad7",
    name: "Paulus Kirke",
    lat: 59.9263636,
    lng: 10.7560554,
    googleMapsUrl: "https://maps.app.goo.gl/cxfVnnrqevvXK6i66",
    ikon: "church",
  },
  {
    id: "36e8d369-6e2d-80cf-a2f9-ff8fa9e808f3",
    name: "Tårnet",
    lat: 59.9269905,
    lng: 10.816382,
    googleMapsUrl: "https://maps.app.goo.gl/dJVb6CioPS4FEVQ1A",
    ikon: "ring",
  },
];

export async function fetchLocationsFromNotion(
  localEnv?: Env,
  context?: ExecutionContext,
): Promise<WeddingLocation[]> {
  const currentEnv = localEnv || env;
  const kv = currentEnv?.WEDDING_CACHE;
  const cacheKey = "notion_locations";

  // 1. Try to read from KV cache
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;

        // If cache is stale (> 1 minute), trigger background update (SWR)
        if (age > 60 * 1000) {
          console.log(
            `Locations cache is stale (${Math.round(age / 1000)}s), triggering background refresh...`,
          );
          const updatePromise = updateLocationsCache(currentEnv).catch(
            (err) => {
              console.error("Error in background locations sync:", err);
            },
          );

          // If running under Cloudflare Workers, register the background promise
          if (context?.waitUntil) {
            context.waitUntil(updatePromise);
          }
        }

        return data;
      }
    } catch (err) {
      console.error("KV read error for Notion locations:", err);
    }
  }

  // 2. Cache miss: Fetch and update synchronously
  console.log("Locations cache miss, performing synchronous fetch...");
  try {
    return await updateLocationsCache(currentEnv);
  } catch (err) {
    console.error(
      "Error fetching locations from Notion, falling back to static list:",
      err,
    );
    return fallbackLocations;
  }
}

async function updateLocationsCache(
  localEnv?: Env,
): Promise<WeddingLocation[]> {
  const currentEnv = localEnv || env;
  const notion = getNotionClient(currentEnv);
  const kv = currentEnv?.WEDDING_CACHE;
  const cacheKey = "notion_locations";

  const locationsDbId =
    currentEnv?.NOTION_LOCATIONS_DATABASE_ID ||
    process.env.NOTION_LOCATIONS_DATABASE_ID ||
    notionConfig.databases.locationsId;
  if (!locationsDbId) {
    throw new Error("NOTION_LOCATIONS_DATABASE_ID is not configured.");
  }

  const locationsDsId = await getDataSourceId(notion, locationsDbId);

  const response = await notion.dataSources.query({
    data_source_id: locationsDsId,
  });

  const locations: WeddingLocation[] = (
    response.results as PageObjectResponse[]
  )
    .filter((page): page is PageObjectResponse => "properties" in page)
    .map((page) => {
      const props = page.properties;

      // Name (title)
      const name =
        props.Name?.type === "title"
          ? props.Name.title?.[0]?.plain_text || "Ukjent sted"
          : "Ukjent sted";

      // Lat (number)
      const lat =
        props.Lat?.type === "number" && typeof props.Lat.number === "number"
          ? props.Lat.number
          : null;

      // Long / Lng (number)
      const lng =
        props.Long?.type === "number" && typeof props.Long.number === "number"
          ? props.Long.number
          : props.Lng?.type === "number" && typeof props.Lng.number === "number"
            ? props.Lng.number
            : null;

      // Google Maps (url)
      const googleMapsUrl =
        props["Google Maps"]?.type === "url" && props["Google Maps"].url
          ? props["Google Maps"].url
          : undefined;

      // Ikon (text or select)
      let ikon = "default";
      const ikonProp = props.Ikon || props.ikon;
      if (ikonProp?.type === "rich_text" && ikonProp.rich_text) {
        ikon =
          (ikonProp.rich_text as NotionRichTextItem[])
            .map((t) => t.plain_text)
            .join("")
            .trim()
            .toLowerCase() || "default";
      } else if (ikonProp?.type === "select" && ikonProp.select) {
        ikon =
          (ikonProp.select as NotionSelectItem).name.trim().toLowerCase() ||
          "default";
      }

      // Map categories to dynamic fallback icons
      ikon = getIconForLocation(name, ikon);

      return {
        id: page.id,
        name,
        lat,
        lng,
        googleMapsUrl,
        ikon,
      };
    })
    .filter(
      (loc): loc is WeddingLocation & { lat: number; lng: number } =>
        loc.lat !== null && loc.lng !== null,
    );

  // Save to KV cache with current timestamp
  if (kv) {
    try {
      const cacheValue = JSON.stringify({
        data: locations,
        timestamp: Date.now(),
      });
      await kv.put(cacheKey, cacheValue);
      console.log("Notion locations cache updated successfully.");
    } catch (err) {
      console.error("KV write error for Notion locations:", err);
    }
  }

  return locations;
}

function getIconForLocation(name: string, ikon?: string): string {
  const customIkon = (ikon || "default").trim().toLowerCase();
  if (customIkon !== "default" && customIkon !== "") {
    return customIkon;
  }

  const lowerName = name.toLowerCase();
  if (lowerName.includes("kirke")) {
    return "church";
  }
  if (
    lowerName.includes("tårnet") ||
    lowerName.includes("fest") ||
    lowerName.includes("kulturarena") ||
    lowerName.includes("selskapslokale")
  ) {
    return "ring";
  }
  if (
    lowerName.includes("hotell") ||
    lowerName.includes("hotel") ||
    lowerName.includes("overnatting")
  ) {
    return "hotel";
  }
  if (
    lowerName.includes("park") ||
    lowerName.includes("hage") ||
    lowerName.includes("plass") ||
    lowerName.includes("birkelunden")
  ) {
    return "park";
  }
  if (
    lowerName.includes("brygghus") ||
    lowerName.includes("bar") ||
    lowerName.includes("restaurant") ||
    lowerName.includes("mat")
  ) {
    return "food";
  }
  if (lowerName.includes("buss")) {
    return "buss";
  }
  return "default";
}
