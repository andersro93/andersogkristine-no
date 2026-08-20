import { notionConfig } from "../../config/notion";
import { escapeHtml } from "../../utils/html";
import { cachedSWR, type WaitUntilContext } from "../cache";
import {
  CACHE_KEYS,
  fallback,
  getRelationIds,
  getRichTextFull,
  getTitleProperty,
  queryDatabase,
} from "./shared";

// ---------------------------------------------------------------------------
// Contributors (Medvirkende) & Egentid — raw rows, cached and shared
// ---------------------------------------------------------------------------

export interface RawContributor {
  id: string;
  name: string;
  photo: string;
  role: string;
  emoji: string;
  email: string;
}

export interface RawEgentidItem {
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
    const m = notionConfig.mappings.contributors;
    const name = getTitleProperty(props[m.name], "Ukjent");

    let email = "";
    const emailProp = props[m.email];
    if (emailProp?.type === "email" && emailProp.email) {
      email = emailProp.email;
    } else if (emailProp?.type === "rich_text") {
      email = getRichTextFull(emailProp, "");
    }

    let notionPhoto = "";
    const bildeProp = props[m.photo];
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
      role: getRichTextFull(props[m.role], ""),
      emoji: getRichTextFull(props[m.emoji], ""),
      email,
    };
  });
}

async function loadRawEgentidItems(env: Env): Promise<RawEgentidItem[]> {
  const pages = await queryDatabase(env, "NOTION_EGENTID_DATABASE_ID");
  return pages.map((page) => {
    const props = page.properties;
    const m = notionConfig.mappings.egentid;
    return {
      id: page.id,
      title: getTitleProperty(props[m.title], ""),
      description: getRichTextFull(props[m.description], ""),
      contributorId: getRelationIds(props[m.contributor])[0] ?? "",
      locationIds: getRelationIds(props[m.location]),
    };
  });
}

export function fetchRawContributors(env: Env, ctx?: WaitUntilContext) {
  return cachedSWR(env, ctx, { key: CACHE_KEYS.contributorsRaw }, () =>
    loadRawContributors(env),
  );
}

export function fetchRawEgentidItems(env: Env, ctx?: WaitUntilContext) {
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
  return cachedSWR(
    env,
    ctx,
    {
      key: CACHE_KEYS.egentid,
      fallback: () => fallback.egentid?.contributors ?? [],
    },
    () => loadEgentid(env, ctx),
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
  return cachedSWR(
    env,
    ctx,
    { key: CACHE_KEYS.toastmasters, fallback: () => [] },
    async () => {
      const rawContributors = await fetchRawContributors(env, ctx);
      return rawContributors
        .filter((c) => c.role.toLowerCase().includes("toastmaster"))
        .map(({ name, email, photo }) => ({ name, email, photo }));
    },
  );
}
