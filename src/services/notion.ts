import type { PageObjectResponse } from "@notionhq/client";
import { Client } from "@notionhq/client";
import { notionConfig } from "../config/notion";
import notionFallback from "../config/notion-fallback.json";
import {
  cachedSWR,
  getDataSourceId,
  invalidateCache,
  queryAll,
  type WaitUntilContext,
} from "./cache";

export type { WaitUntilContext } from "./cache";

/** KV cache keys — kept stable across refactors (tests and ops rely on them). */
export const CACHE_KEYS = {
  schedule: "notion_schedule",
  locations: "notion_locations",
  egentid: "notion_egentid_contributors",
  toastmasters: "notion_toastmaster",
  faq: "notion_faq",
  story: "notion_story",
  flags: "notion_flags",
  seating: "seating_data",
  contributorsRaw: "notion_contributors_raw",
  egentidRaw: "notion_egentid_raw",
} as const;

// ---------------------------------------------------------------------------
// Property helpers
// ---------------------------------------------------------------------------

interface NotionRichTextItem {
  plain_text: string;
}

interface NotionSelectItem {
  name: string;
}

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

/** Escape text for safe interpolation into HTML text nodes and attributes. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function notionRichTextToHtml(prop: any, fallback = ""): string {
  if (prop?.type !== "rich_text" || !Array.isArray(prop.rich_text)) {
    return fallback;
  }

  // 1. Convert each rich text item into HTML with annotations, keeping \n intact
  const htmlParts = prop.rich_text.map((item: any) => {
    let text = escapeHtml(item.plain_text || "");

    const ann = item.annotations || {};
    if (ann.bold) text = `<strong>${text}</strong>`;
    if (ann.italic) text = `<em>${text}</em>`;
    if (ann.strikethrough) text = `<del>${text}</del>`;
    if (ann.underline) text = `<u>${text}</u>`;
    if (ann.code) text = `<code>${text}</code>`;

    if (item.href) {
      const url = String(item.href);
      if (/^https?:\/\/|^mailto:/i.test(url)) {
        text = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="underline hover:text-brand-title/80 transition-colors">${text}</a>`;
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

/**
 * Reads the allergy property as a list of items. Accepts both the current
 * multi_select type and the legacy select type, so guests who answered before
 * the Notion column was converted still see their answer.
 */
function getAllergyItems(prop: any): string[] {
  if (prop?.type === "multi_select") {
    return getMultiSelectProperty(prop);
  }
  const legacy = getSelectProperty(prop);
  return legacy ? [legacy] : [];
}

// Notion rejects commas in select/multi_select option names, and caps the name
// at 100 characters.
const ALLERGY_ITEM_MAX_LENGTH = 100;
const ALLERGY_ITEM_MAX_COUNT = 20;

/**
 * Normalises untrusted allergy input into names Notion will accept: splits on
 * commas, trims, drops empties, truncates, and removes case-insensitive
 * duplicates while keeping the first spelling.
 */
export function sanitizeAllergyItems(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of items) {
    if (typeof raw !== "string") {
      continue;
    }
    for (const part of raw.split(",")) {
      const name = part.trim().slice(0, ALLERGY_ITEM_MAX_LENGTH);
      if (!name) {
        continue;
      }
      const key = name.toLocaleLowerCase("nb");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(name);
      if (result.length >= ALLERGY_ITEM_MAX_COUNT) {
        return result;
      }
    }
  }

  return result;
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

function getRelationIds(prop: any): string[] {
  return prop?.type === "relation" && Array.isArray(prop.relation)
    ? prop.relation.map((r: any) => r.id)
    : [];
}

function getPageEmoji(page: any): string | null {
  const icon = page?.icon;
  return icon?.type === "emoji" && icon.emoji ? icon.emoji : null;
}

function requireDatabaseId(env: Env, key: keyof Env & string): string {
  const value = env?.[key];
  if (!value || typeof value !== "string") {
    throw new Error(
      `${key} is not configured. Please check your environment configuration or .env file.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function getNotionClient(env: Env) {
  const apiKey = env?.NOTION_API_KEY;
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

/** Query every row of the database referenced by `envKey`, following pagination. */
async function queryDatabase(
  env: Env,
  envKey: keyof Env & string,
  filter?: any,
): Promise<PageObjectResponse[]> {
  const notion = getNotionClient(env);
  const dsId = await getDataSourceId(
    notion,
    requireDatabaseId(env, envKey),
    env,
  );
  const rows = await queryAll(notion, {
    data_source_id: dsId,
    ...(filter ? { filter } : {}),
  });
  return (rows as PageObjectResponse[]).filter(
    (page): page is PageObjectResponse => "properties" in page,
  );
}

// ---------------------------------------------------------------------------
// Invites & guests (live, never cached)
// ---------------------------------------------------------------------------

export interface Guest {
  id: string;
  name: string;
  rsvp: string; // "Venter" | "Kommer" | "Kommer ikke"
  allergies: string[]; // multi_select option names
  tableId?: string | null;
  tableName?: string | null;
}

export interface Invite {
  id: string;
  code: string;
  name: string;
  guests: Guest[];
}

export async function fetchInviteByCode(
  code: string,
  env: Env,
): Promise<Invite | null> {
  const notion = getNotionClient(env);

  try {
    const invitesDsId = await getDataSourceId(
      notion,
      requireDatabaseId(env, "NOTION_INVITES_DATABASE_ID"),
      env,
    );

    const invitesResponse = await notion.dataSources.query({
      data_source_id: invitesDsId,
      filter: {
        property: notionConfig.mappings.invites.code,
        rich_text: { equals: code.trim() },
      },
    });

    if (invitesResponse.results.length === 0) {
      return null;
    }

    const invitePage = invitesResponse.results[0];
    if (!("properties" in invitePage)) {
      return null;
    }

    const inviteName = getTitleProperty(
      invitePage.properties[notionConfig.mappings.invites.name],
      "Invitasjon",
    );
    const inviteCode = getRichTextProperty(
      invitePage.properties[notionConfig.mappings.invites.code],
    );
    const guestIds = getRelationIds(
      invitePage.properties[notionConfig.mappings.invites.guests],
    );

    const guestResults = await Promise.all(
      guestIds.map(async (id): Promise<Guest | null> => {
        try {
          const guestPage = (await notion.pages.retrieve({
            page_id: id,
          })) as PageObjectResponse;
          if (!("properties" in guestPage)) return null;

          const props = guestPage.properties;
          const guestRsvpProp = props[notionConfig.mappings.guests.rsvp];
          const guestRsvp =
            guestRsvpProp?.type === "status"
              ? guestRsvpProp.status?.name || notionConfig.rsvpStatus.pending
              : notionConfig.rsvpStatus.pending;

          return {
            id: guestPage.id,
            name: getTitleProperty(props[notionConfig.mappings.guests.name]),
            rsvp: guestRsvp,
            allergies: getAllergyItems(
              props[notionConfig.mappings.guests.allergies],
            ),
            tableId:
              getRelationIds(props[notionConfig.mappings.guests.table])[0] ??
              null,
          };
        } catch (err) {
          console.error(`Error fetching guest ${id}:`, err);
          return null;
        }
      }),
    );

    return {
      id: invitePage.id,
      code: inviteCode,
      name: inviteName,
      guests: guestResults.filter((g): g is Guest => g !== null),
    };
  } catch (error) {
    console.error("Error in fetchInviteByCode:", error);
    throw error;
  }
}

/**
 * Update a guest's RSVP status and allergies.
 * `allergies` are Notion multi_select option names; unknown names are created
 * by Notion on write (the couple reviews them before they go to the kitchen).
 */
export async function updateGuestRSVP(
  guestId: string,
  rsvp: string,
  allergies: string[],
  env: Env,
): Promise<void> {
  const notion = getNotionClient(env);

  try {
    await notion.pages.update({
      page_id: guestId,
      properties: {
        [notionConfig.mappings.guests.rsvp]: { status: { name: rsvp } },
        [notionConfig.mappings.guests.allergies]: {
          multi_select: sanitizeAllergyItems(allergies).map((name) => ({
            name,
          })),
        },
      } as any,
    });
  } catch (error) {
    console.error(`Error updating guest RSVP for ${guestId}:`, error);
    throw error;
  }
}

/**
 * Reads the existing option names off the allergy property so the RSVP form can
 * offer them back as suggestions. Keeping guests on the existing spellings is
 * what stops the option list from fragmenting.
 *
 * Under notionVersion 2025-09-03 the property schema lives on the data source,
 * not on the database container. Returns [] on any failure — the chip input
 * still works without suggestions, and this must never break the RSVP page.
 */
export async function fetchAllergyOptions(env: Env): Promise<string[]> {
  try {
    const notion = getNotionClient(env);
    const guestsDsId = await getDataSourceId(
      notion,
      requireDatabaseId(env, "NOTION_GUESTS_DATABASE_ID"),
      env,
    );

    const dataSource: any = await notion.dataSources.retrieve({
      data_source_id: guestsDsId,
    });

    const prop =
      dataSource?.properties?.[notionConfig.mappings.guests.allergies];
    // Accept the legacy select type so suggestions work before the conversion.
    const options: NotionSelectItem[] =
      prop?.multi_select?.options ?? prop?.select?.options ?? [];

    return options
      .map((option) => option.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "nb"));
  } catch (error) {
    console.error("Error fetching allergy options:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Seating
// ---------------------------------------------------------------------------

export interface TableWithGuests {
  id: string;
  name: string;
  guests: { id: string; name: string }[];
}

async function loadSeating(env: Env): Promise<TableWithGuests[]> {
  const [tablePages, guestPages] = await Promise.all([
    queryDatabase(env, "NOTION_TABLES_DATABASE_ID"),
    queryDatabase(env, "NOTION_GUESTS_DATABASE_ID"),
  ]);

  const tablesMap = new Map<string, TableWithGuests>();
  for (const page of tablePages) {
    tablesMap.set(page.id, {
      id: page.id,
      name: getTitleProperty(
        page.properties[notionConfig.mappings.tables.name],
        "Bord",
      ),
      guests: [],
    });
  }

  for (const page of guestPages) {
    const tableId = getRelationIds(
      page.properties[notionConfig.mappings.guests.table],
    )[0];
    const table = tableId ? tablesMap.get(tableId) : undefined;
    if (table) {
      table.guests.push({
        id: page.id,
        name: getTitleProperty(
          page.properties[notionConfig.mappings.guests.name],
        ),
      });
    }
  }

  const tables = Array.from(tablesMap.values());
  for (const table of tables) {
    table.guests.sort((a, b) => a.name.localeCompare(b.name, "nb"));
  }
  tables.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return tables;
}

/**
 * Tables with their guests, cached in KV (SWR, 60 s). Falls back to the
 * prebuild snapshot if Notion is unreachable and nothing is cached.
 */
export async function fetchAllSeatingData(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<TableWithGuests[]> {
  return cachedSWR(
    env,
    ctx,
    {
      key: CACHE_KEYS.seating,
      fallback: () =>
        ((notionFallback as any).seating || []) as TableWithGuests[],
    },
    () => loadSeating(env),
  );
}

/** Invalidate the seating cache (call after RSVP/table changes). */
export async function invalidateSeatingCache(env: Env): Promise<void> {
  await invalidateCache(env, CACHE_KEYS.seating);
}

// ---------------------------------------------------------------------------
// Schedule / program
// ---------------------------------------------------------------------------

export interface ScheduleEvent {
  time: string;
  title: string;
  description: string;
  icon: string;
  locationId?: string;
}

async function loadSchedule(env: Env): Promise<ScheduleEvent[]> {
  const pages = await queryDatabase(env, "NOTION_PROGRAM_DATABASE_ID", {
    property: "Webside",
    select: { equals: "Ja" },
  });

  const formatter = new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });

  return pages
    .map((page) => {
      const props = page.properties;
      const descProp =
        props.Beskrivelse ||
        props.beskrivelse ||
        props.description ||
        props.Info ||
        props.Detaljer;
      return {
        title: getTitleProperty(props.Tittel, "Uten tittel"),
        timeIso: getDateProperty(props.Tidspunkt),
        description: getRichTextFull(descProp),
        emoji: getPageEmoji(page) ?? "💛",
        locationId: getRelationIds(props.Sted)[0],
      };
    })
    .filter((e): e is typeof e & { timeIso: string } => e.timeIso !== null)
    .sort(
      (a, b) => new Date(a.timeIso).getTime() - new Date(b.timeIso).getTime(),
    )
    .map((e) => ({
      time: formatter.format(new Date(e.timeIso)),
      title: e.title,
      description: e.description,
      icon: e.emoji,
      locationId: e.locationId,
    }));
}

export async function fetchScheduleFromNotion(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<ScheduleEvent[]> {
  return cachedSWR(env, ctx, { key: CACHE_KEYS.schedule }, () =>
    loadSchedule(env),
  );
}

// ---------------------------------------------------------------------------
// Contributors (Medvirkende) & Egentid — raw rows, cached and shared
// ---------------------------------------------------------------------------

interface RawContributor {
  id: string;
  name: string;
  photo: string;
  role: string;
  emoji: string;
  email: string;
}

interface RawEgentidItem {
  id: string;
  title: string;
  description: string;
  contributorId: string;
  locationIds: string[];
}

/**
 * Local photo lookup: files in public/images/egentid (by lowercase first name),
 * public/images/egentid/downloads (by Notion page id, written by prebuild) and
 * public/images/toastmaster (by lowercase first name). Resolved at build time
 * via Vite glob so the Worker never needs the filesystem. Falls back to the
 * (expiring) Notion URL when nothing local exists.
 */
// Vite resolves `import.meta.glob` at build time (must be a literal call).
// Under bun test there is no glob → empty manifest → Notion URL fallback.
let LOCAL_PHOTO_FILES: string[] = [];
try {
  LOCAL_PHOTO_FILES = Object.keys(
    import.meta.glob([
      "/public/images/egentid/*.{webp,jpg,jpeg,png,gif}",
      "/public/images/egentid/downloads/*.{webp,jpg,jpeg,png,gif}",
      "/public/images/toastmaster/*.{webp,jpg,jpeg,png,gif}",
    ]),
  ).map((p) => p.replace(/^\/public/, ""));
} catch {
  LOCAL_PHOTO_FILES = [];
}

export function resolveContributorPhoto(
  contributor: { id: string; name: string },
  notionUrl: string,
  localFiles: string[] = LOCAL_PHOTO_FILES,
): string {
  const firstName = contributor.name.split(" ")[0]?.toLowerCase() ?? "";
  const byId = localFiles.find((f) =>
    f.startsWith(`/images/egentid/downloads/${contributor.id}.`),
  );
  if (byId) return byId;
  const byName = localFiles.find(
    (f) =>
      f.startsWith(`/images/egentid/${firstName}.`) ||
      f.startsWith(`/images/toastmaster/${firstName}.`),
  );
  if (byName) return byName;
  return notionUrl || `/images/egentid/${firstName}.webp`;
}

async function loadRawContributors(env: Env): Promise<RawContributor[]> {
  const pages = await queryDatabase(env, "NOTION_MEDVIRKENDE_DATABASE_ID");
  return pages.map((page) => {
    const props = page.properties;
    const name = getTitleProperty(props.Name || props.Navn, "Ukjent");

    let email = "";
    const emailProp = props.Email || props.email || props["E-post"];
    if (emailProp?.type === "email" && emailProp.email) {
      email = emailProp.email;
    } else if (emailProp?.type === "rich_text") {
      email = getRichTextFull(emailProp, "");
    }

    let notionPhoto = "";
    const bildeProp = props.Bilde || props.bilde || props.Photo || props.photo;
    if (bildeProp?.type === "files" && bildeProp.files?.length > 0) {
      const fileObj = bildeProp.files[0] as any;
      notionPhoto =
        fileObj.type === "file"
          ? fileObj.file?.url || ""
          : fileObj.type === "external"
            ? fileObj.external?.url || ""
            : "";
    }

    return {
      id: page.id,
      name,
      photo: resolveContributorPhoto({ id: page.id, name }, notionPhoto),
      role: getRichTextFull(props.Role || props.Rolle, ""),
      emoji: getRichTextFull(props.Emoji, ""),
      email,
    };
  });
}

async function loadRawEgentidItems(env: Env): Promise<RawEgentidItem[]> {
  const pages = await queryDatabase(env, "NOTION_EGENTID_DATABASE_ID");
  return pages.map((page) => {
    const props = page.properties;
    return {
      id: page.id,
      title: getTitleProperty(props.Name || props.Tittel || props.tittel, ""),
      description: getRichTextFull(
        props.Beskrivelse || props.Info || props.Details,
        "",
      ),
      contributorId:
        getRelationIds(
          props.Medvirkende ||
            props.medvirkende ||
            props.Contributor ||
            props.contributor,
        )[0] ?? "",
      locationIds: getRelationIds(
        props["📍 Sted"] ||
          props.Sted ||
          props.sted ||
          props.Location ||
          props.location,
      ),
    };
  });
}

function fetchRawContributors(env: Env, ctx?: WaitUntilContext) {
  return cachedSWR(env, ctx, { key: CACHE_KEYS.contributorsRaw }, () =>
    loadRawContributors(env),
  );
}

function fetchRawEgentidItems(env: Env, ctx?: WaitUntilContext) {
  return cachedSWR(env, ctx, { key: CACHE_KEYS.egentidRaw }, () =>
    loadRawEgentidItems(env),
  );
}

// ---------------------------------------------------------------------------
// Egentid (recommendations) & toastmasters
// ---------------------------------------------------------------------------

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
  email?: string;
  suggestions: EgentidSuggestion[];
}

const CONTRIBUTOR_DESCRIPTIONS: Record<string, string> = {
  kristine: "Drinker, drinker, drinker",
  anders: "Kaffe og øl",
  nora: "Enkel mat og avslapping",
  lilo: "Tur og mat",
};

async function loadEgentid(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<Contributor[]> {
  const [rawContributors, rawEgentidItems] = await Promise.all([
    fetchRawContributors(env, ctx),
    fetchRawEgentidItems(env, ctx),
  ]);

  return rawContributors
    .map((c) => {
      const suggestions: EgentidSuggestion[] = rawEgentidItems
        .filter((item) => item.contributorId === c.id)
        .map((item) => ({
          text: `<strong>${escapeHtml(item.title)}</strong> &mdash; ${escapeHtml(item.description)}`,
          locationId: item.locationIds[0] || undefined,
        }));

      return {
        id: c.id,
        name: c.name,
        photo: c.photo,
        role: c.role || `${c.name}s favoritter`,
        description:
          CONTRIBUTOR_DESCRIPTIONS[c.name.toLowerCase()] ??
          `Anbefalinger fra ${c.name}.`,
        emoji: c.emoji,
        email: c.email || undefined,
        suggestions,
      };
    })
    .filter((c) => c.suggestions.length > 0);
}

/** Contributors with at least one Egentid suggestion (KV SWR cached). */
export async function fetchEgentidData(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<Contributor[]> {
  return cachedSWR(env, ctx, { key: CACHE_KEYS.egentid }, () =>
    loadEgentid(env, ctx),
  );
}

export interface Toastmaster {
  name: string;
  email: string;
  photo: string;
}

/** Contributors whose role contains "toastmaster" (KV SWR cached). */
export async function fetchToastmasters(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<Toastmaster[]> {
  return cachedSWR(env, ctx, { key: CACHE_KEYS.toastmasters }, async () => {
    const rawContributors = await fetchRawContributors(env, ctx);
    return rawContributors
      .filter((c) => c.role.toLowerCase().includes("toastmaster"))
      .map(({ name, email, photo }) => ({ name, email, photo }));
  });
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

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
  zone?: [number, number][];
  zoneColor?: string;
}

function parseZone(raw: string): [number, number][] | undefined {
  if (!raw.trim()) return undefined;
  const parsed = raw
    .split(";")
    .map((segment) => {
      const parts = segment.trim().split(",");
      if (parts.length >= 2) {
        const lat = Number.parseFloat(parts[0].trim());
        const lng = Number.parseFloat(parts[1].trim());
        if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
          return [lat, lng] as [number, number];
        }
      }
      return null;
    })
    .filter((pair): pair is [number, number] => pair !== null);
  return parsed.length >= 3 ? parsed : undefined;
}

async function loadLocations(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<WeddingLocation[]> {
  // Compose from the cached fetchers so a cold start shares work with the
  // homepage instead of re-querying Notion for schedule/contributors/egentid.
  const [pages, scheduleEvents, rawContributors, rawEgentidItems] =
    await Promise.all([
      queryDatabase(env, "NOTION_LOCATIONS_DATABASE_ID"),
      fetchScheduleFromNotion(env, ctx),
      fetchRawContributors(env, ctx),
      fetchRawEgentidItems(env, ctx),
    ]);

  return pages
    .map((page) => {
      const props = page.properties;
      const name = getTitleProperty(props.Name, "Ukjent sted");
      const lat = getNumberProperty(props.Lat, null);
      const lng =
        getNumberProperty(props.Long, null) ??
        getNumberProperty(props.Lng, null);
      const googleMapsUrl =
        props["Google Maps"]?.type === "url" && props["Google Maps"].url
          ? props["Google Maps"].url
          : undefined;

      const activities: LocationActivity[] = [];
      for (const e of scheduleEvents.filter((e) => e.locationId === page.id)) {
        activities.push({ type: "program", title: e.title, time: e.time });
      }
      for (const item of rawEgentidItems.filter((i) =>
        i.locationIds.includes(page.id),
      )) {
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
        ikon: getEmojiForLocation(name, getPageEmoji(page)),
        activities,
        zone: parseZone(getRichTextFull(props.Sone || props.sone)),
        zoneColor:
          getSelectProperty(props["Sone-farge"] || props["sone-farge"]) ||
          undefined,
      };
    })
    .filter((loc) => loc.lat !== null && loc.lng !== null) as WeddingLocation[];
}

export async function fetchLocationsFromNotion(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<WeddingLocation[]> {
  return cachedSWR(
    env,
    ctx,
    {
      key: CACHE_KEYS.locations,
      fallback: () =>
        ((notionFallback as any).locations || []) as WeddingLocation[],
    },
    () => loadLocations(env, ctx),
  );
}

function getEmojiForLocation(name: string, pageEmoji: string | null): string {
  if (pageEmoji) return pageEmoji;

  const lowerName = name.toLowerCase();
  if (lowerName.includes("kirke")) return "⛪";
  if (
    lowerName.includes("tårnet") ||
    lowerName.includes("fest") ||
    lowerName.includes("kulturarena") ||
    lowerName.includes("selskapslokale")
  ) {
    return "🏛️";
  }
  if (
    lowerName.includes("hotell") ||
    lowerName.includes("hotel") ||
    lowerName.includes("overnatting")
  ) {
    return "🏨";
  }
  if (
    lowerName.includes("park") ||
    lowerName.includes("hage") ||
    lowerName.includes("plass") ||
    lowerName.includes("birkelunden")
  ) {
    return "🌳";
  }
  if (
    lowerName.includes("brygghus") ||
    lowerName.includes("bar") ||
    lowerName.includes("restaurant") ||
    lowerName.includes("mat")
  ) {
    return "🍻";
  }
  if (lowerName.includes("buss")) return "🚌";
  if (lowerName.includes("trikk")) return "🚃";
  if (lowerName.includes("parkering") || lowerName.includes("parking")) {
    return "🅿️";
  }
  return "📍";
}

/** Bulk update location coordinates (used by scripts/update_locations.ts). */
export async function bulkUpdateLocations(
  updates: Array<{ id: string; lat: number; lng: number }>,
  env: Env,
): Promise<void> {
  const notion = getNotionClient(env);
  for (const update of updates) {
    console.log(
      `Updating location ${update.id} to (${update.lat}, ${update.lng})…`,
    );
    await notion.pages.update({
      page_id: update.id,
      properties: {
        Lat: { number: update.lat },
        Long: { number: update.lng },
      } as any,
    });
  }
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

export interface FaqItem {
  question: string;
  answer: string;
}

async function loadFaq(env: Env): Promise<FaqItem[]> {
  const pages = await queryDatabase(env, "NOTION_FAQ_DATABASE_ID");
  return pages
    .map((page) => {
      const props = page.properties;
      return {
        question: getTitleProperty(
          props.Spørsmål || props.Sporsmal || props.Question || props.Name,
          "Uten spørsmål",
        ),
        answer: notionRichTextToHtml(
          props.Svar || props.Answer || props.Description,
          "",
        ),
      };
    })
    .filter((faq) => faq.question && faq.question.trim() !== "Uten spørsmål");
}

export async function fetchFaqFromNotion(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<FaqItem[]> {
  return cachedSWR(env, ctx, { key: CACHE_KEYS.faq }, () => loadFaq(env));
}

// ---------------------------------------------------------------------------
// Our story
// ---------------------------------------------------------------------------

export interface StoryItem {
  year: string;
  title: string;
  content: string;
}

async function loadStory(env: Env): Promise<StoryItem[]> {
  const pages = await queryDatabase(env, "NOTION_STORY_DATABASE_ID");
  return pages
    .map((page) => {
      const props = page.properties;
      const dateStr = getDateProperty(props.Dato || props.Date) || "";
      return {
        year: dateStr ? dateStr.split("-")[0] : "",
        title: getTitleProperty(
          props.Tittel || props.Title || props.Name,
          "Uten tittel",
        ),
        content: getRichTextFull(
          props.Beskrivelse || props.Content || props.Description,
          "",
        ),
        dateStr,
      };
    })
    .filter((item) => item.year)
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr))
    .map(({ year, title, content }) => ({ year, title, content }));
}

export async function fetchStoryFromNotion(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<StoryItem[]> {
  return cachedSWR(
    env,
    ctx,
    {
      key: CACHE_KEYS.story,
      fallback: () => ((notionFallback as any).story || []) as StoryItem[],
    },
    () => loadStory(env),
  );
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

/** Defaults come from the prebuild snapshot; missing → everything enabled. */
export const DEFAULT_FLAGS: Record<string, boolean> = {
  rsvp: true,
  seating: true,
  music: true,
  map: true,
  egentid: true,
  program: true,
  ...((notionFallback as any).flags || {}),
};

async function loadFlags(env: Env): Promise<Record<string, boolean>> {
  const pages = await queryDatabase(env, "NOTION_FLAGS_DATABASE_ID");
  const flags = { ...DEFAULT_FLAGS };

  for (const page of pages) {
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

    const activeProp = props.Aktivert as any;
    let isEnabled = false;
    if (activeProp?.type === "select") {
      isEnabled = activeProp.select?.name === "Ja";
    } else if (activeProp?.type === "status") {
      isEnabled = activeProp.status?.name === "Ja";
    } else if (activeProp?.type === "rich_text") {
      isEnabled = getRichTextFull(activeProp).trim() === "Ja";
    }
    flags[flagKey] = isEnabled;
  }

  return flags;
}

/**
 * Feature flags from Notion (KV SWR cached). If Notion cannot be reached and
 * nothing is cached, the prebuild defaults are returned (and not cached).
 */
export async function fetchFeatureFlags(
  env: Env,
  ctx?: WaitUntilContext,
): Promise<Record<string, boolean>> {
  return cachedSWR(
    env,
    ctx,
    { key: CACHE_KEYS.flags, fallback: () => ({ ...DEFAULT_FLAGS }) },
    () => loadFlags(env),
  );
}
