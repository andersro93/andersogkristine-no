import { notionConfig } from "../../config/notion";
import { cachedSWR, type WaitUntilContext } from "../cache";
import {
  CACHE_KEYS,
  fallback,
  getDateProperty,
  getPageEmoji,
  getRelationIds,
  getRichTextFull,
  getTitleProperty,
  queryDatabase,
} from "./shared";

export interface ScheduleEvent {
  time: string;
  title: string;
  description: string;
  icon: string;
  locationId?: string;
}

async function loadSchedule(env: Env): Promise<ScheduleEvent[]> {
  const pages = await queryDatabase(env, "NOTION_PROGRAM_DATABASE_ID", {
    property: notionConfig.mappings.program.published,
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
      const m = notionConfig.mappings.program;
      return {
        title: getTitleProperty(props[m.title], "Uten tittel"),
        timeIso: getDateProperty(props[m.time]),
        description: getRichTextFull(props[m.description]),
        emoji: getPageEmoji(page) ?? "💛",
        locationId: getRelationIds(props[m.location])[0],
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
  return cachedSWR(
    env,
    ctx,
    { key: CACHE_KEYS.schedule, fallback: () => fallback.schedule ?? [] },
    () => loadSchedule(env),
  );
}
