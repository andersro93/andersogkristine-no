import { notionConfig } from "../../config/notion";
import { cachedSWR, type WaitUntilContext } from "../cache";
import {
  CACHE_KEYS,
  fallback,
  getRichTextFull,
  getTitleProperty,
  queryDatabase,
} from "./shared";

/** Defaults come from the prebuild snapshot; missing → everything enabled. */
export const DEFAULT_FLAGS: Record<string, boolean> = {
  rsvp: true,
  seating: true,
  music: true,
  map: true,
  egentid: true,
  program: true,
  gallery: true,
  gallery_upload: true,
  ...(fallback.flags ?? {}),
};

async function loadFlags(env: Env): Promise<Record<string, boolean>> {
  const pages = await queryDatabase(env, "NOTION_FLAGS_DATABASE_ID");
  const flags = { ...DEFAULT_FLAGS };

  for (const page of pages) {
    const props = page.properties;
    const flagKey = getTitleProperty(props[notionConfig.mappings.flags.id], "")
      .trim()
      .toLowerCase();
    if (!flagKey) continue;

    const activeProp = props[notionConfig.mappings.flags.enabled] as any;
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
