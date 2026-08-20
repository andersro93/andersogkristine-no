import type { Client } from "@notionhq/client";

/** Minimal subset of Cloudflare's ExecutionContext that we need. */
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface CachedSWROptions<T> {
  /** KV key. */
  key: string;
  /** After this age the cached value is still served but refreshed in the background. Default 60 s. */
  staleAfterMs?: number;
  /**
   * After this age the cached value is considered unusable and a synchronous
   * reload happens instead. Default: never (serve stale forever if the source
   * is down — deliberate resilience choice for a wedding site).
   */
  hardTtlMs?: number;
  /** Used when there is no usable cache entry and the loader throws. */
  fallback?: () => T;
}

interface CacheEnvelope<T> {
  data: T;
  timestamp: number;
}

const DEFAULT_STALE_AFTER_MS = 60 * 1000;

/**
 * Stale-while-revalidate read-through cache on top of Cloudflare KV.
 *
 * - cache hit, fresh      → return cached
 * - cache hit, stale      → return cached, refresh in background (ctx.waitUntil)
 * - miss / hard-expired   → run loader synchronously, store, return
 * - loader throws on miss → return `fallback()` if given, else rethrow
 *
 * KV unavailable (local scripts, tests without CACHE) → loader every call.
 */
export async function cachedSWR<T>(
  env: Env | undefined,
  ctx: WaitUntilContext | undefined,
  options: CachedSWROptions<T>,
  loader: () => Promise<T>,
): Promise<T> {
  const kv = env?.CACHE;
  const {
    key,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    hardTtlMs,
    fallback,
  } = options;

  const store = async (data: T): Promise<void> => {
    if (!kv) return;
    try {
      const envelope: CacheEnvelope<T> = { data, timestamp: Date.now() };
      await kv.put(key, JSON.stringify(envelope));
    } catch (err) {
      console.error(`KV write error for ${key}:`, err);
    }
  };

  const loadAndStore = async (): Promise<T> => {
    const data = await loader();
    await store(data);
    return data;
  };

  if (kv) {
    try {
      const raw = await kv.get(key);
      if (raw) {
        const { data, timestamp } = JSON.parse(raw) as CacheEnvelope<T>;
        const age = Date.now() - (timestamp ?? 0);
        const hardExpired = hardTtlMs !== undefined && age > hardTtlMs;

        if (!hardExpired) {
          if (age > staleAfterMs) {
            const refresh = loadAndStore().catch((err) => {
              console.error(`Background refresh failed for ${key}:`, err);
            });
            if (ctx?.waitUntil) {
              ctx.waitUntil(refresh);
            }
          }
          return data;
        }
        console.log(
          `Cache entry ${key} hard-expired (${Math.round(age / 1000)}s), reloading synchronously.`,
        );
      }
    } catch (err) {
      console.error(`KV read error for ${key}:`, err);
    }
  }

  try {
    return await loadAndStore();
  } catch (err) {
    if (fallback) {
      console.error(`Loader failed for ${key}, using fallback:`, err);
      return fallback();
    }
    throw err;
  }
}

/** Delete a cache entry (e.g. after a write that invalidates it). */
export async function invalidateCache(
  env: Env | undefined,
  key: string,
): Promise<void> {
  const kv = env?.CACHE;
  if (!kv) return;
  try {
    await kv.delete(key);
  } catch (err) {
    console.error(`KV delete error for ${key}:`, err);
  }
}

type QueryParams = Omit<
  Parameters<Client["dataSources"]["query"]>[0],
  "start_cursor" | "page_size"
>;

/**
 * Query a Notion data source and follow pagination until every row is read.
 * Notion returns at most 100 rows per page; ignoring `has_more` silently
 * drops rows past that, so every query in this codebase goes through here.
 */
export async function queryAll(
  notion: Client,
  params: QueryParams,
): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await notion.dataSources.query({
      ...params,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as any);
    results.push(...(page.results as any[]));
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

// Data-source id resolution: in-memory per isolate + KV across isolates.
const dataSourceIdMemory = new Map<string, string>();

/**
 * Resolve the data-source id for a Notion database container. The id is
 * stable, so it is cached in memory and in KV (no TTL) to avoid an extra
 * `databases.retrieve` round-trip on every cold start.
 */
export async function getDataSourceId(
  notion: Client,
  databaseId: string,
  env?: Env,
): Promise<string> {
  const mem = dataSourceIdMemory.get(databaseId);
  if (mem) return mem;

  const kv = env?.CACHE;
  const kvKey = `notion_dsid:${databaseId}`;
  if (kv) {
    try {
      const cached = await kv.get(kvKey);
      if (cached) {
        dataSourceIdMemory.set(databaseId, cached);
        return cached;
      }
    } catch (err) {
      console.error("KV read error for data source id:", err);
    }
  }

  console.log(`Resolving data source ID for database: ${databaseId}`);
  const db = await notion.databases.retrieve({ database_id: databaseId });
  if ("data_sources" in db && db.data_sources && db.data_sources.length > 0) {
    const dsId = db.data_sources[0].id;
    dataSourceIdMemory.set(databaseId, dsId);
    if (kv) {
      try {
        await kv.put(kvKey, dsId);
      } catch (err) {
        console.error("KV write error for data source id:", err);
      }
    }
    return dsId;
  }
  throw new Error(`No data source found for database container: ${databaseId}`);
}

/** Test helper. */
export function clearDataSourceIdMemory(): void {
  dataSourceIdMemory.clear();
}
