import { notionConfig } from "../../config/notion";
import { cachedSWR, invalidateCache, type WaitUntilContext } from "../cache";
import {
  CACHE_KEYS,
  fallback,
  getRelationIds,
  getTitleProperty,
  queryDatabase,
} from "./shared";

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
      fallback: () => fallback.seating ?? [],
    },
    () => loadSeating(env),
  );
}

/** Invalidate the seating cache (call after RSVP/table changes). */
export async function invalidateSeatingCache(env: Env): Promise<void> {
  await invalidateCache(env, CACHE_KEYS.seating);
}
