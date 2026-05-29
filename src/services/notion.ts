import type { PageObjectResponse } from "@notionhq/client";
import { Client } from "@notionhq/client";
import { notionConfig } from "../config/notion";
import notionFallback from "../config/notion-fallback.json";
import { cloudflareEnv, getEnvVar, requireEnvVar } from "./env";

// Helper interfaces for Notion API JSON properties
interface NotionRichTextItem {
  plain_text: string;
}

interface NotionSelectItem {
  name: string;
}

// Property extraction helpers to eliminate inline null-coalescing and type assertions
function getTitleProperty(prop: any, fallback = ""): string {
  return prop?.type === "title"
    ? prop.title?.[0]?.plain_text || fallback
    : fallback;
}

function getRichTextProperty(prop: any, fallback = ""): string {
  return prop?.type === "rich_text"
    ? (prop.rich_text as NotionRichTextItem[])?.[0]?.plain_text || fallback
    : fallback;
}

function getRichTextFull(prop: any, fallback = ""): string {
  return prop?.type === "rich_text"
    ? (prop.rich_text as NotionRichTextItem[]).map((t) => t.plain_text).join("")
    : fallback;
}

function notionRichTextToHtml(prop: any, fallback = ""): string {
  if (prop?.type !== "rich_text" || !Array.isArray(prop.rich_text)) {
    return fallback;
  }

  // 1. Convert each rich text item into HTML with annotations, keeping \n intact
  const htmlParts = prop.rich_text.map((item: any) => {
    let text = item.plain_text || "";

    // Escape HTML entities to prevent XSS
    text = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

    const ann = item.annotations || {};
    if (ann.bold) text = `<strong>${text}</strong>`;
    if (ann.italic) text = `<em>${text}</em>`;
    if (ann.strikethrough) text = `<del>${text}</del>`;
    if (ann.underline) text = `<u>${text}</u>`;
    if (ann.code) text = `<code>${text}</code>`;

    if (item.href) {
      const url = item.href;
      if (/^https?:\/\/|^mailto:/i.test(url)) {
        text = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline hover:text-brand-title/80 transition-colors">${text}</a>`;
      }
    }

    return text;
  });

  const fullHtml = htmlParts.join("");

  // 2. Process line by line to support basic list syntax and line breaks
  const lines = fullHtml.split("\n");
  let inList = false;
  const resultLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if the line is a bullet point (starts with -, *, or •)
    const match = trimmed.match(/^(?:&bull;|-|•|\*)\s*(.*)/);
    if (match) {
      if (!inList) {
        inList = true;
        resultLines.push('<ul class="list-disc pl-5 space-y-1 my-2">');
      }
      resultLines.push(`<li>${match[1]}</li>`);
    } else {
      if (inList) {
        inList = false;
        resultLines.push("</ul>");
      }
      if (trimmed === "") {
        // Empty line becomes a paragraph break/spacing
        resultLines.push('<div class="h-2"></div>');
      } else {
        resultLines.push(`<p>${line}</p>`);
      }
    }
  }

  if (inList) {
    resultLines.push("</ul>");
  }

  return resultLines.join("");
}

function getSelectProperty(prop: any, fallback = ""): string {
  return prop?.type === "select" ? prop.select?.name || fallback : fallback;
}

function getMultiSelectProperty(prop: any): string[] {
  return prop?.type === "multi_select"
    ? (prop.multi_select as NotionSelectItem[]).map((s) => s.name)
    : [];
}

function getDateProperty(prop: any): string | null {
  return prop?.type === "date" ? prop.date?.start || null : null;
}

function getNumberProperty(
  prop: any,
  fallback: number | null = 0,
): number | null {
  return prop?.type === "number" && typeof prop.number === "number"
    ? prop.number
    : fallback;
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
  const apiKey = getEnvVar("NOTION_API_KEY", localEnv);
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
    const invitesDbId = requireEnvVar("NOTION_INVITES_DATABASE_ID", localEnv);
    const invitesDsId = await getDataSourceId(notion, invitesDbId);

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
    const inviteName = getTitleProperty(
      invitePage.properties[notionConfig.mappings.invites.name],
      "Invitasjon",
    );
    const inviteCode = getRichTextProperty(
      invitePage.properties[notionConfig.mappings.invites.code],
    );

    // Fetch related guests
    const guestsRelation =
      invitePage.properties[notionConfig.mappings.invites.guests];
    const guestIds: string[] = [];
    if (
      guestsRelation?.type === "relation" &&
      Array.isArray(guestsRelation.relation)
    ) {
      guestIds.push(...guestsRelation.relation.map((r: any) => r.id));
    }

    // Fetch each guest in parallel
    const guests: Guest[] = [];
    if (guestIds.length > 0) {
      const guestPromises = guestIds.map(async (id) => {
        try {
          const guestPage = (await notion.pages.retrieve({
            page_id: id,
          })) as PageObjectResponse;
          if ("properties" in guestPage) {
            const guestName = getTitleProperty(
              guestPage.properties[notionConfig.mappings.guests.name],
            );

            const guestRsvpProp =
              guestPage.properties[notionConfig.mappings.guests.rsvp];
            const guestRsvp =
              guestRsvpProp?.type === "status"
                ? guestRsvpProp.status?.name || notionConfig.rsvpStatus.pending
                : notionConfig.rsvpStatus.pending;

            const guestAllergies = getSelectProperty(
              guestPage.properties[notionConfig.mappings.guests.allergies],
            );

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
    const properties: Record<string, any> = {
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
      const propertiesRetry: Record<string, any> = {
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
    const tablesDbId = requireEnvVar("NOTION_TABLES_DATABASE_ID", localEnv);
    const tablesDsId = await getDataSourceId(notion, tablesDbId);

    // A. Query all tables
    const tablesResponse = await notion.dataSources.query({
      data_source_id: tablesDsId,
    });

    const tablesMap = new Map<string, TableWithGuests>();

    for (const page of tablesResponse.results as PageObjectResponse[]) {
      if ("properties" in page) {
        const tableName = getTitleProperty(
          page.properties[notionConfig.mappings.tables.name],
          "Bord",
        );

        tablesMap.set(page.id, {
          id: page.id,
          name: tableName,
          guests: [],
        });
      }
    }

    const guestsDbId = requireEnvVar("NOTION_GUESTS_DATABASE_ID", localEnv);
    const guestsDsId = await getDataSourceId(notion, guestsDbId);

    // B. Query all guests
    const guestsResponse = await notion.dataSources.query({
      data_source_id: guestsDsId,
      page_size: 100, // Adjust as necessary
    });

    // C. Map guests to their respective tables
    for (const page of guestsResponse.results as PageObjectResponse[]) {
      if ("properties" in page) {
        const guestName = getTitleProperty(
          page.properties[notionConfig.mappings.guests.name],
        );

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
  locationId?: string;
}

/**
 * Retrieves the wedding schedule timeline from the Notion program database,
 * cached in Cloudflare KV with Stale-While-Revalidate (SWR) logic.
 */
export async function fetchScheduleFromNotion(
  localEnv?: Env,
  context?: { waitUntil(promise: Promise<any>): void },
): Promise<ScheduleEvent[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const kv = currentEnv?.CACHE;
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
  locationId?: string;
}

async function updateScheduleCache(localEnv?: Env): Promise<ScheduleEvent[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const notion = getNotionClient(currentEnv);
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_schedule";

  const programDbId = getEnvVar("NOTION_PROGRAM_DATABASE_ID", localEnv);
  if (!programDbId) {
    throw new Error("NOTION_PROGRAM_DATABASE_ID is not configured.");
  }

  const programDsId = await getDataSourceId(notion, programDbId);

  // Query database: Webside = Ja
  const response = await notion.dataSources.query({
    data_source_id: programDsId,
    filter: {
      property: "Webside",
      select: {
        equals: "Ja",
      },
    },
  });

  const rawEvents = (response.results as PageObjectResponse[])
    .filter((page): page is PageObjectResponse => "properties" in page)
    .map((page): RawScheduleEvent => {
      const props = page.properties;

      // Title
      const title = getTitleProperty(props.Tittel, "Uten tittel");

      // Time ISO (for sorting)
      const timeIso = getDateProperty(props.Tidspunkt);

      // Description (safe fallback to multiple possible names)
      const descProp =
        props.Beskrivelse ||
        props.beskrivelse ||
        props.description ||
        props.Info ||
        props.Detaljer;
      const description = getRichTextFull(descProp);

      // Categories
      const categories = getMultiSelectProperty(props.Kategori);

      // Sted (relation)
      const stedProp = props.Sted;
      const locationId =
        stedProp?.type === "relation" &&
        Array.isArray(stedProp.relation) &&
        stedProp.relation.length > 0
          ? stedProp.relation[0].id
          : undefined;

      return {
        title,
        timeIso,
        description,
        categories,
        locationId,
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
      locationId: e.locationId,
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

export interface LocationActivity {
  type: "program" | "egentid";
  title: string;
  time?: string;
  description?: string;
  suggestedBy?: string;
  suggestedByEmoji?: string;
}

export interface WeddingLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  googleMapsUrl?: string;
  ikon?: string;
  activities?: LocationActivity[];
}

// Locations fallback: sourced from prebuild-generated notion-fallback.json
const fallbackLocations: WeddingLocation[] =
  (notionFallback as any).locations || [];

export async function fetchLocationsFromNotion(
  localEnv?: Env,
  context?: { waitUntil(promise: Promise<any>): void },
): Promise<WeddingLocation[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const kv = currentEnv?.CACHE;
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
  const currentEnv = localEnv || cloudflareEnv;
  const notion = getNotionClient(currentEnv);
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_locations";

  const locationsDbId = getEnvVar("NOTION_LOCATIONS_DATABASE_ID", localEnv);
  if (!locationsDbId) {
    throw new Error("NOTION_LOCATIONS_DATABASE_ID is not configured.");
  }

  const locationsDsId = await getDataSourceId(notion, locationsDbId);

  // Fetch locations, schedule, contributors, and egentid items in parallel
  const [response, scheduleEvents, rawContributors, rawEgentidItems] =
    await Promise.all([
      notion.dataSources.query({ data_source_id: locationsDsId }),
      fetchScheduleFromNotion(localEnv),
      fetchRawContributors(localEnv),
      fetchRawEgentidItems(localEnv),
    ]);

  const locations: WeddingLocation[] = (
    response.results as PageObjectResponse[]
  )
    .filter((page): page is PageObjectResponse => "properties" in page)
    .map((page) => {
      const props = page.properties;

      // Name (title)
      const name = getTitleProperty(props.Name, "Ukjent sted");

      // Lat (number)
      const lat = getNumberProperty(props.Lat, null);

      // Long / Lng (number)
      const lng =
        getNumberProperty(props.Long, null) ??
        getNumberProperty(props.Lng, null);

      // Google Maps (url)
      const googleMapsUrl =
        props["Google Maps"]?.type === "url" && props["Google Maps"].url
          ? props["Google Maps"].url
          : undefined;

      // Ikon (text or select)
      let ikon = "default";
      const ikonProp = props.Ikon || props.ikon;
      if (ikonProp) {
        if (ikonProp.type === "rich_text") {
          ikon = getRichTextFull(ikonProp).trim().toLowerCase() || "default";
        } else if (ikonProp.type === "select" && ikonProp.select) {
          ikon =
            (ikonProp.select as NotionSelectItem).name.trim().toLowerCase() ||
            "default";
        }
      }

      // Map categories to dynamic fallback icons
      ikon = getIconForLocation(name, ikon);

      // Map program schedule events for this location
      const locationSchedule = scheduleEvents.filter(
        (e) => e.locationId === page.id,
      );

      // Map Egentid recommendations for this location
      const locationEgentids = rawEgentidItems.filter((item) =>
        item.locationIds.includes(page.id),
      );

      const activities: LocationActivity[] = [];

      for (const e of locationSchedule) {
        activities.push({
          type: "program",
          title: e.title,
          time: e.time,
        });
      }

      for (const item of locationEgentids) {
        const contributor = rawContributors.find(
          (c) => c.id === item.contributorId,
        );
        activities.push({
          type: "egentid",
          title: item.title,
          description: item.description,
          suggestedBy: contributor?.name || "Ukjent",
          suggestedByEmoji: contributor?.emoji || "📍",
        });
      }

      return {
        id: page.id,
        name,
        lat,
        lng,
        googleMapsUrl,
        ikon,
        activities,
      };
    })
    .filter((loc) => loc.lat !== null && loc.lng !== null) as WeddingLocation[];

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

/**
 * Bulk updates location coordinates in the Notion database.
 */
export async function bulkUpdateLocations(
  updates: Array<{ id: string; lat: number; lng: number }>,
  localEnv?: Env,
): Promise<void> {
  const notion = getNotionClient(localEnv);
  for (const update of updates) {
    console.log(
      `Updating location ${update.id} to (${update.lat}, ${update.lng})…`,
    );
    await notion.pages.update({
      page_id: update.id,
      properties: {
        Lat: {
          number: update.lat,
        },
        Long: {
          number: update.lng,
        },
      } as any,
    });
  }
}

interface RawContributor {
  id: string;
  name: string;
  photo: string;
  role: string;
  emoji: string;
}

interface RawEgentidItem {
  id: string;
  title: string;
  description: string;
  contributorId: string;
  locationIds: string[];
}

export interface EgentidSuggestion {
  text: string;
  locationId?: string;
}

export interface Contributor {
  id: string;
  name: string;
  photo: string;
  role: string;
  description: string;
  emoji?: string;
  suggestions: EgentidSuggestion[];
}

// Helper to fetch raw contributors from Notion
async function fetchRawContributors(localEnv?: Env): Promise<RawContributor[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const notion = getNotionClient(currentEnv);
  const medvirkendeDbId = getEnvVar("NOTION_MEDVIRKENDE_DATABASE_ID", localEnv);
  if (!medvirkendeDbId) {
    throw new Error("NOTION_MEDVIRKENDE_DATABASE_ID is not configured.");
  }

  const dsId = await getDataSourceId(notion, medvirkendeDbId);
  const response = await notion.dataSources.query({
    data_source_id: dsId,
  });

  return (response.results as PageObjectResponse[])
    .filter((page): page is PageObjectResponse => "properties" in page)
    .map((page) => {
      const props = page.properties;
      const name = getTitleProperty(props.Name || props.Navn, "Ukjent");
      const role = getRichTextFull(props.Role || props.Rolle, "");
      const emoji = getRichTextFull(props.Emoji, "");

      // Handle photo (Bilde files property)
      let photo = "";
      const bildeProp =
        props.Bilde || props.bilde || props.Photo || props.photo;
      if (
        bildeProp?.type === "files" &&
        Array.isArray(bildeProp.files) &&
        bildeProp.files.length > 0
      ) {
        const fileObj = bildeProp.files[0];
        if (fileObj.type === "file") {
          photo = fileObj.file?.url || "";
        } else if (fileObj.type === "external") {
          photo = fileObj.external?.url || "";
        }
      }

      // Fallback photo
      if (!photo) {
        photo = `/images/egentid/${name.toLowerCase()}.webp`;
      }

      return {
        id: page.id,
        name,
        photo,
        role,
        emoji,
      };
    });
}

// Helper to fetch raw Egentid suggestions from Notion
async function fetchRawEgentidItems(localEnv?: Env): Promise<RawEgentidItem[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const notion = getNotionClient(currentEnv);
  const egentidDbId = getEnvVar("NOTION_EGENTID_DATABASE_ID", localEnv);
  if (!egentidDbId) {
    throw new Error("NOTION_EGENTID_DATABASE_ID is not configured.");
  }

  const dsId = await getDataSourceId(notion, egentidDbId);
  const response = await notion.dataSources.query({
    data_source_id: dsId,
  });

  return (response.results as PageObjectResponse[])
    .filter((page): page is PageObjectResponse => "properties" in page)
    .map((page) => {
      const props = page.properties;
      const title = getTitleProperty(
        props.Name || props.Tittel || props.tittel,
        "",
      );
      const description = getRichTextFull(
        props.Beskrivelse || props.Info || props.Details,
        "",
      );

      // Medvirkende (relation)
      const medvirkendeProp =
        props.Medvirkende ||
        props.medvirkende ||
        props.Contributor ||
        props.contributor;
      const contributorId =
        medvirkendeProp?.type === "relation" &&
        Array.isArray(medvirkendeProp.relation) &&
        medvirkendeProp.relation.length > 0
          ? medvirkendeProp.relation[0].id
          : "";

      // Sted (relation)
      const stedProp =
        props["📍 Sted"] ||
        props.Sted ||
        props.sted ||
        props.Location ||
        props.location;
      const locationIds: string[] = [];
      if (stedProp?.type === "relation" && Array.isArray(stedProp.relation)) {
        locationIds.push(...stedProp.relation.map((r: any) => r.id));
      }

      return {
        id: page.id,
        title,
        description,
        contributorId,
        locationIds,
      };
    });
}

/**
 * Retrieves the Egentid contributors and suggestions from Notion,
 * cached in Cloudflare KV with SWR logic. Only returns contributors
 * who have at least one active suggestion.
 */
export async function fetchEgentidData(
  localEnv?: Env,
  context?: { waitUntil(promise: Promise<any>): void },
): Promise<Contributor[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_egentid_contributors";

  // 1. Try to read from KV cache
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;

        // Notion S3 URLs expire after 1 hour.
        // If the cache is older than 45 minutes, force a synchronous fetch
        // to avoid serving expired image links to the user.
        if (age > 45 * 60 * 1000) {
          console.log(
            "Egentid cache is too old (S3 URLs may be expired), forcing synchronous fetch...",
          );
        } else {
          // If cache is stale (> 1 minute), trigger background update (SWR)
          if (age > 60 * 1000) {
            console.log(
              `Egentid cache is stale (${Math.round(age / 1000)}s), triggering background refresh...`,
            );
            const updatePromise = updateEgentidCache(currentEnv).catch(
              (err) => {
                console.error("Error in background Egentid sync:", err);
              },
            );

            if (context?.waitUntil) {
              context.waitUntil(updatePromise);
            }
          }

          return data;
        }
      }
    } catch (err) {
      console.error("KV read error for Egentid contributors:", err);
    }
  }

  // 2. Cache miss: Fetch and update synchronously
  console.log("Egentid cache miss, performing synchronous fetch...");
  return await updateEgentidCache(currentEnv);
}

async function updateEgentidCache(localEnv?: Env): Promise<Contributor[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_egentid_contributors";

  console.log("Updating Egentid KV cache...");
  const [rawContributors, rawEgentidItems] = await Promise.all([
    fetchRawContributors(localEnv),
    fetchRawEgentidItems(localEnv),
  ]);

  const contributorsList: Contributor[] = rawContributors
    .map((c) => {
      // Find suggestions for this contributor
      const contributorItems = rawEgentidItems.filter(
        (item) => item.contributorId === c.id,
      );

      const suggestions: EgentidSuggestion[] = contributorItems.map((item) => {
        return {
          text: `<strong>${item.title}</strong> &mdash; ${item.description}`,
          locationId: item.locationIds?.[0] || undefined,
        };
      });

      // Maintain static copy fallback for description if none exists in DB
      let description = `Anbefalinger fra ${c.name}.`;
      if (c.name.toLowerCase() === "kristine") {
        description = "Koselige kafeer og rolige, grønne lunger.";
      } else if (c.name.toLowerCase() === "anders") {
        description = "Beste ølserveringer, rask mat og utsiktspunkter.";
      } else if (c.name.toLowerCase() === "nora") {
        description = "Lekeplasser, vaffel og byens beste isbarer.";
      } else if (c.name.toLowerCase() === "lilo") {
        description = "Hundeparker, turområder og de beste snusestoppene.";
      }

      return {
        id: c.id,
        name: c.name,
        photo: c.photo,
        role: c.role || `${c.name}s favoritter`,
        description,
        emoji: c.emoji,
        suggestions,
      };
    })
    // Only keep contributors who actually have Egentid suggestions
    .filter((c) => c.suggestions.length > 0);

  // Save to KV cache
  if (kv) {
    try {
      const cacheValue = JSON.stringify({
        data: contributorsList,
        timestamp: Date.now(),
      });
      await kv.put(cacheKey, cacheValue);
      console.log("Egentid KV cache updated successfully.");
    } catch (err) {
      console.error("KV write error for Egentid:", err);
    }
  }

  return contributorsList;
}

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Retrieves the FAQs from the Notion FAQ database,
 * cached in Cloudflare KV with SWR logic.
 */
export async function fetchFaqFromNotion(
  localEnv?: Env,
  context?: { waitUntil(promise: Promise<any>): void },
): Promise<FaqItem[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_faq";

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
            `FAQ cache is stale (${Math.round(age / 1000)}s), triggering background refresh...`,
          );
          const updatePromise = updateFaqCache(currentEnv).catch((err) => {
            console.error("Error in background FAQ sync:", err);
          });

          // Register background promise if context is available
          if (context?.waitUntil) {
            context.waitUntil(updatePromise);
          }
        }

        return data;
      }
    } catch (err) {
      console.error("KV read error for Notion FAQs:", err);
    }
  }

  // 2. Cache miss: Fetch and update synchronously
  console.log("FAQ cache miss, performing synchronous fetch...");
  return await updateFaqCache(currentEnv);
}

async function updateFaqCache(localEnv?: Env): Promise<FaqItem[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const notion = getNotionClient(currentEnv);
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_faq";

  const faqDbId = getEnvVar("NOTION_FAQ_DATABASE_ID", localEnv);
  if (!faqDbId) {
    throw new Error("NOTION_FAQ_DATABASE_ID is not configured.");
  }

  const dsId = await getDataSourceId(notion, faqDbId);
  const response = await notion.dataSources.query({
    data_source_id: dsId,
  });

  const faqs: FaqItem[] = (response.results as PageObjectResponse[])
    .filter((page): page is PageObjectResponse => "properties" in page)
    .map((page) => {
      const props = page.properties;
      const question = getTitleProperty(
        props["Spørsmål"] || props.Sporsmal || props.Question || props.Name,
        "Uten spørsmål",
      );
      const answer = notionRichTextToHtml(
        props["Svar"] || props.Svar || props.Answer || props.Description,
        "",
      );

      return {
        question,
        answer,
      };
    })
    // Filter out items that have no question
    .filter((faq) => faq.question && faq.question.trim() !== "Uten spørsmål");

  // Save to KV cache
  if (kv) {
    try {
      const cacheValue = JSON.stringify({
        data: faqs,
        timestamp: Date.now(),
      });
      await kv.put(cacheKey, cacheValue);
      console.log("Notion FAQ cache updated successfully.");
    } catch (err) {
      console.error("KV write error for Notion FAQs:", err);
    }
  }

  return faqs;
}

export interface ToastmasterData {
  name: string;
  email: string;
  phone: string;
}

/**
 * Retrieves the toastmaster details from the "Medvirkende" table,
 * cached in Cloudflare KV with SWR logic.
 */
export async function fetchToastmasterFromNotion(
  localEnv?: Env,
  context?: { waitUntil(promise: Promise<any>): void },
): Promise<ToastmasterData> {
  const currentEnv = localEnv || cloudflareEnv;
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_toastmaster";
  const fallback = (notionFallback as any).toastmaster || {
    name: "",
    email: "",
    phone: "",
  };

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
            `Toastmaster cache is stale (${Math.round(age / 1000)}s), triggering background refresh...`,
          );
          const updatePromise = updateToastmasterCache(currentEnv).catch(
            (err) => {
              console.error("Error in background toastmaster sync:", err);
            },
          );

          // Register background promise if context is available
          if (context?.waitUntil) {
            context.waitUntil(updatePromise);
          }
        }

        return data;
      }
    } catch (err) {
      console.error("KV read error for Notion toastmaster:", err);
    }
  }

  // 2. Cache miss: Fetch and update synchronously
  console.log("Toastmaster cache miss, performing synchronous fetch...");
  try {
    return await updateToastmasterCache(currentEnv);
  } catch (err) {
    console.error(
      "Error fetching toastmaster from Notion, using fallback:",
      err,
    );
    return fallback;
  }
}

async function updateToastmasterCache(
  localEnv?: Env,
): Promise<ToastmasterData> {
  const currentEnv = localEnv || cloudflareEnv;
  const notion = getNotionClient(currentEnv);
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_toastmaster";
  const fallback = (notionFallback as any).toastmaster || {
    name: "",
    email: "",
    phone: "",
  };

  const medvirkendeDbId = getEnvVar("NOTION_MEDVIRKENDE_DATABASE_ID", localEnv);
  if (!medvirkendeDbId) {
    throw new Error("NOTION_MEDVIRKENDE_DATABASE_ID is not configured.");
  }

  const dsId = await getDataSourceId(notion, medvirkendeDbId);
  const response = await notion.dataSources.query({
    data_source_id: dsId,
  });

  // Find the page where Role/Rolle equals "Toastmaster"
  let toastmasterPage: PageObjectResponse | null = null;
  for (const page of response.results as PageObjectResponse[]) {
    if ("properties" in page) {
      const role = getRichTextFull(
        page.properties.Role || page.properties.Rolle,
        "",
      );
      if (role.trim().toLowerCase() === "toastmaster") {
        toastmasterPage = page;
        break;
      }
    }
  }

  if (!toastmasterPage) {
    console.warn("No Toastmaster found in Medvirkende database.");
    return fallback;
  }

  const props = toastmasterPage.properties;
  const name = getTitleProperty(props.Name || props.Navn, "Ukjent");

  // Get email
  let email = "";
  const emailProp = props.Email || props.email || props.Epost || props.epost;
  if (emailProp?.type === "email") {
    email = emailProp.email || "";
  }

  // Get phone
  let phone = "";
  const phoneProp =
    props.Telefon || props.telefon || props.Phone || props.phone;
  if (phoneProp?.type === "phone_number") {
    phone = phoneProp.phone_number || "";
  }

  const data: ToastmasterData = {
    name,
    email,
    phone,
  };

  if (kv) {
    try {
      const cacheValue = JSON.stringify({
        data,
        timestamp: Date.now(),
      });
      await kv.put(cacheKey, cacheValue);
      console.log("Notion Toastmaster cache updated successfully.");
    } catch (err) {
      console.error("KV write error for Notion Toastmaster:", err);
    }
  }

  return data;
}

export interface StoryItem {
  year: string;
  title: string;
  content: string;
}

/**
 * Retrieves the story timeline items from the Notion story database,
 * cached in Cloudflare KV with SWR logic.
 */
export async function fetchStoryFromNotion(
  localEnv?: Env,
  context?: { waitUntil(promise: Promise<any>): void },
): Promise<StoryItem[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_story";
  const fallback = (notionFallback as any).story || [];

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
            `Story cache is stale (${Math.round(age / 1000)}s), triggering background refresh...`,
          );
          const updatePromise = updateStoryCache(currentEnv).catch((err) => {
            console.error("Error in background story sync:", err);
          });

          // Register background promise if context is available
          if (context?.waitUntil) {
            context.waitUntil(updatePromise);
          }
        }

        return data;
      }
    } catch (err) {
      console.error("KV read error for Notion story:", err);
    }
  }

  // 2. Cache miss: Fetch and update synchronously
  console.log("Story cache miss, performing synchronous fetch...");
  try {
    return await updateStoryCache(currentEnv);
  } catch (err) {
    console.error("Error fetching story from Notion, using fallback:", err);
    return fallback;
  }
}

async function updateStoryCache(localEnv?: Env): Promise<StoryItem[]> {
  const currentEnv = localEnv || cloudflareEnv;
  const notion = getNotionClient(currentEnv);
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_story";

  const storyDbId = getEnvVar("NOTION_STORY_DATABASE_ID", localEnv);
  if (!storyDbId) {
    throw new Error("NOTION_STORY_DATABASE_ID is not configured.");
  }

  const dsId = await getDataSourceId(notion, storyDbId);
  const response = await notion.dataSources.query({
    data_source_id: dsId,
  });

  const storyItems: StoryItem[] = (response.results as PageObjectResponse[])
    .filter((page): page is PageObjectResponse => "properties" in page)
    .map((page) => {
      const props = page.properties;
      const title = getTitleProperty(
        props.Tittel || props.Title || props.Name,
        "Uten tittel",
      );
      const content = getRichTextFull(
        props.Beskrivelse || props.Content || props.Description,
        "",
      );

      const dateStr = getDateProperty(props.Dato || props.Date);
      const year = dateStr ? dateStr.split("-")[0] : "";

      return {
        year,
        title,
        content,
        dateStr: dateStr || "",
      };
    })
    .filter((item) => item.year)
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr))
    .map(({ year, title, content }) => ({ year, title, content }));

  if (kv) {
    try {
      const cacheValue = JSON.stringify({
        data: storyItems,
        timestamp: Date.now(),
      });
      await kv.put(cacheKey, cacheValue);
      console.log("Notion Story cache updated successfully.");
    } catch (err) {
      console.error("KV write error for Notion Story:", err);
    }
  }

  return storyItems;
}

// Feature flags fallback: sourced from prebuild-generated notion-fallback.json
const DEFAULT_FLAGS: Record<string, boolean> =
  (notionFallback as any).flags || {};

/**
 * Retrieves the feature flags from the Notion flags database,
 * cached in Cloudflare KV with SWR logic.
 */
export async function fetchFeatureFlags(
  localEnv?: Env,
  context?: { waitUntil(promise: Promise<any>): void },
): Promise<Record<string, boolean>> {
  const currentEnv = localEnv || cloudflareEnv;
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_flags";

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
            `Flags cache is stale (${Math.round(age / 1000)}s), triggering background refresh...`,
          );
          const updatePromise = updateFlagsCache(currentEnv).catch((err) => {
            console.error("Error in background flags sync:", err);
          });

          // Register background promise if context is available
          if (context?.waitUntil) {
            context.waitUntil(updatePromise);
          }
        }

        return data;
      }
    } catch (err) {
      console.error("KV read error for Notion feature flags:", err);
    }
  }

  // 2. Cache miss: Fetch and update synchronously
  console.log("Flags cache miss, performing synchronous fetch...");
  return await updateFlagsCache(currentEnv);
}

async function updateFlagsCache(
  localEnv?: Env,
): Promise<Record<string, boolean>> {
  const currentEnv = localEnv || cloudflareEnv;
  const notion = getNotionClient(currentEnv);
  const kv = currentEnv?.CACHE;
  const cacheKey = "notion_flags";

  const flagsDbId = getEnvVar("NOTION_FLAGS_DATABASE_ID", localEnv);
  if (!flagsDbId) {
    throw new Error("NOTION_FLAGS_DATABASE_ID is not configured.");
  }

  const flags = { ...DEFAULT_FLAGS };

  try {
    const dsId = await getDataSourceId(notion, flagsDbId);
    const response = await notion.dataSources.query({
      data_source_id: dsId,
    });

    for (const page of response.results as PageObjectResponse[]) {
      if (!("properties" in page)) continue;
      const props = page.properties;

      const flagIdProp =
        props["Flagg Id"] ||
        props["Flagg ID"] ||
        props["flagg id"] ||
        props["Flag id"] ||
        props["Flag ID"] ||
        props["flag id"] ||
        props.Name;
      const flagKey = getTitleProperty(flagIdProp, "").trim().toLowerCase();

      if (!flagKey) continue;

      const activeProp = props.Aktivert;
      let isEnabled = false;
      if (activeProp) {
        if (activeProp.type === "select") {
          isEnabled = activeProp.select?.name === "Ja";
        } else if (activeProp.type === "status") {
          isEnabled = activeProp.status?.name === "Ja";
        } else if (activeProp.type === "rich_text") {
          isEnabled = getRichTextFull(activeProp).trim() === "Ja";
        }
      }

      flags[flagKey] = isEnabled;
    }

    // Save to KV cache
    if (kv) {
      try {
        const cacheValue = JSON.stringify({
          data: flags,
          timestamp: Date.now(),
        });
        await kv.put(cacheKey, cacheValue);
        console.log("Notion flags cache updated successfully.");
      } catch (err) {
        console.error("KV write error for Notion flags:", err);
      }
    }
  } catch (error) {
    console.error(
      "Failed to query Notion feature flags, falling back to defaults:",
      error,
    );
  }

  return flags;
}
