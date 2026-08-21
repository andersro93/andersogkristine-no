import { notionConfig } from "../../config/notion";
import { cachedSWR, type WaitUntilContext } from "../cache";
import {
  CACHE_KEYS,
  fallback,
  getDateProperty,
  getRichTextFull,
  getTitleProperty,
  notionRichTextToHtml,
  queryDatabase,
} from "./shared";

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
          props[notionConfig.mappings.faq.question],
          "Uten spørsmål",
        ),
        answer: notionRichTextToHtml(
          props[notionConfig.mappings.faq.answer],
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
  return cachedSWR(
    env,
    ctx,
    { key: CACHE_KEYS.faq, fallback: () => fallback.faqs ?? [] },
    () => loadFaq(env),
  );
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
      const m = notionConfig.mappings.story;
      const dateStr = getDateProperty(props[m.date]) || "";
      return {
        year: dateStr ? dateStr.split("-")[0] : "",
        title: getTitleProperty(props[m.title], "Uten tittel"),
        content: getRichTextFull(props[m.content], ""),
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
      fallback: () => fallback.story ?? [],
    },
    () => loadStory(env),
  );
}
