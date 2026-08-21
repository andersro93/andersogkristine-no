import type { PageObjectResponse } from "@notionhq/client";
import { Client } from "@notionhq/client";
import notionFallback from "../../config/notion-fallback.json";
import { escapeHtml } from "../../utils/html";
import { getDataSourceId, queryAll } from "../cache";
import type { FaqItem, StoryItem } from "./content";
import type { WeddingLocation } from "./locations";
import type { Contributor } from "./people";
import type { ScheduleEvent } from "./program";
import type { TableWithGuests } from "./seating";

/** Prebuild snapshot (src/config/notion-fallback.json) used when Notion is unreachable and nothing is cached. */
export const fallback = notionFallback as unknown as {
  schedule?: ScheduleEvent[];
  faqs?: FaqItem[];
  egentid?: { contributors?: Contributor[] };
  locations?: WeddingLocation[];
  seating?: TableWithGuests[];
  story?: StoryItem[];
  flags?: Record<string, boolean>;
};

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

export interface NotionRichTextItem {
  plain_text: string;
}

export interface NotionSelectItem {
  name: string;
}

export function getTitleProperty(prop: any, fallback = ""): string {
  return prop?.type === "title"
    ? prop.title?.[0]?.plain_text || fallback
    : fallback;
}

export function getRichTextProperty(prop: any, fallback = ""): string {
  return prop?.type === "rich_text"
    ? (prop.rich_text as NotionRichTextItem[])?.[0]?.plain_text || fallback
    : fallback;
}

export function getRichTextFull(prop: any, fallback = ""): string {
  return prop?.type === "rich_text"
    ? (prop.rich_text as NotionRichTextItem[]).map((t) => t.plain_text).join("")
    : fallback;
}

export function notionRichTextToHtml(prop: any, fallback = ""): string {
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

export function getSelectProperty(prop: any, fallback = ""): string {
  return prop?.type === "select" ? prop.select?.name || fallback : fallback;
}

export function getMultiSelectProperty(prop: any): string[] {
  return prop?.type === "multi_select"
    ? (prop.multi_select as NotionSelectItem[]).map((s) => s.name)
    : [];
}

export function getDateProperty(prop: any): string | null {
  return prop?.type === "date" ? prop.date?.start || null : null;
}

export function getNumberProperty(
  prop: any,
  fallback: number | null = 0,
): number | null {
  return prop?.type === "number" && typeof prop.number === "number"
    ? prop.number
    : fallback;
}

export function getUrlProperty(prop: any): string | undefined {
  return prop?.type === "url" && prop.url ? prop.url : undefined;
}

export function getRelationIds(prop: any): string[] {
  return prop?.type === "relation" && Array.isArray(prop.relation)
    ? prop.relation.map((r: any) => r.id)
    : [];
}

export function getPageEmoji(page: any): string | null {
  const icon = page?.icon;
  return icon?.type === "emoji" && icon.emoji ? icon.emoji : null;
}

export function requireDatabaseId(env: Env, key: keyof Env & string): string {
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
export async function queryDatabase(
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
