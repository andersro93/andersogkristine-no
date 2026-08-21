import { notionConfig } from "../../config/notion";
import { cachedSWR, type WaitUntilContext } from "../cache";
import { fetchRawContributors, fetchRawEgentidItems } from "./people";
import { fetchScheduleFromNotion } from "./program";
import {
  CACHE_KEYS,
  fallback,
  getNotionClient,
  getNumberProperty,
  getPageEmoji,
  getRichTextFull,
  getSelectProperty,
  getTitleProperty,
  getUrlProperty,
  queryDatabase,
} from "./shared";

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
      const m = notionConfig.mappings.locations;
      const name = getTitleProperty(props[m.name], "Ukjent sted");
      const lat = getNumberProperty(props[m.lat], null);
      const lng = getNumberProperty(props[m.lng], null);
      const googleMapsUrl = getUrlProperty(props[m.googleMaps]);

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
        zone: parseZone(getRichTextFull(props[m.zone])),
        zoneColor: getSelectProperty(props[m.zoneColor]) || undefined,
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
      fallback: () => fallback.locations ?? [],
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
