import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  cachedSWR,
  clearDataSourceIdMemory,
  getDataSourceId,
  invalidateCache,
  queryAll,
} from "./cache";

function makeKV() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: mock(async (key: string) => store.get(key) ?? null),
      put: mock(async (key: string, val: string) => {
        store.set(key, val);
      }),
      delete: mock(async (key: string) => {
        store.delete(key);
      }),
    } as unknown as KVNamespace,
  };
}

describe("cachedSWR", () => {
  let kvBox: ReturnType<typeof makeKV>;
  let env: Env;
  beforeEach(() => {
    kvBox = makeKV();
    env = { CACHE: kvBox.kv } as unknown as Env;
  });

  test("miss → loads, stores envelope {data,timestamp}, returns", async () => {
    const loader = mock(async () => ["a"]);
    const out = await cachedSWR(env, undefined, { key: "k" }, loader);
    expect(out).toEqual(["a"]);
    expect(loader).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(kvBox.store.get("k") as string);
    expect(stored.data).toEqual(["a"]);
    expect(typeof stored.timestamp).toBe("number");
  });

  test("fresh hit → returns cached without calling loader", async () => {
    kvBox.store.set(
      "k",
      JSON.stringify({ data: "cached", timestamp: Date.now() }),
    );
    const loader = mock(async () => "fresh");
    expect(await cachedSWR(env, undefined, { key: "k" }, loader)).toBe(
      "cached",
    );
    expect(loader).not.toHaveBeenCalled();
  });

  test("stale hit → returns cached and refreshes via ctx.waitUntil", async () => {
    kvBox.store.set(
      "k",
      JSON.stringify({ data: "old", timestamp: Date.now() - 120_000 }),
    );
    const loader = mock(async () => "new");
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) };
    expect(
      await cachedSWR(env, ctx, { key: "k", staleAfterMs: 60_000 }, loader),
    ).toBe("old");
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(JSON.parse(kvBox.store.get("k") as string).data).toBe("new");
  });

  test("hard-expired hit → synchronous reload", async () => {
    kvBox.store.set(
      "k",
      JSON.stringify({ data: "ancient", timestamp: Date.now() - 10_000 }),
    );
    const loader = mock(async () => "reloaded");
    expect(
      await cachedSWR(env, undefined, { key: "k", hardTtlMs: 5_000 }, loader),
    ).toBe("reloaded");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("miss + loader throws → fallback returned and NOT cached", async () => {
    const loader = mock(async () => {
      throw new Error("notion down");
    });
    const out = await cachedSWR(
      env,
      undefined,
      { key: "k", fallback: () => "fallback" },
      loader,
    );
    expect(out).toBe("fallback");
    expect(kvBox.store.has("k")).toBe(false);
  });

  test("miss + loader throws + no fallback → rethrows", async () => {
    await expect(
      cachedSWR(env, undefined, { key: "k" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  test("no KV → loader every call", async () => {
    const loader = mock(async () => 1);
    await cachedSWR({} as Env, undefined, { key: "k" }, loader);
    await cachedSWR({} as Env, undefined, { key: "k" }, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test("invalidateCache deletes the key", async () => {
    kvBox.store.set("k", "x");
    await invalidateCache(env, "k");
    expect(kvBox.store.has("k")).toBe(false);
  });
});

describe("queryAll", () => {
  test("follows next_cursor until has_more is false", async () => {
    const calls: any[] = [];
    const notion = {
      dataSources: {
        query: async (params: any) => {
          calls.push(params);
          if (!params.start_cursor) {
            return { results: [1, 2], has_more: true, next_cursor: "c2" };
          }
          if (params.start_cursor === "c2") {
            return { results: [3], has_more: true, next_cursor: "c3" };
          }
          return { results: [4], has_more: false, next_cursor: null };
        },
      },
    } as any;
    const rows = await queryAll(notion, { data_source_id: "ds" });
    expect(rows).toEqual([1, 2, 3, 4]);
    expect(calls).toHaveLength(3);
    expect(calls[0].page_size).toBe(100);
    expect(calls[1].start_cursor).toBe("c2");
  });
});

describe("getDataSourceId", () => {
  beforeEach(() => clearDataSourceIdMemory());

  test("resolves once, then serves from memory and KV", async () => {
    const retrieve = mock(async () => ({ data_sources: [{ id: "ds-1" }] }));
    const notion = { databases: { retrieve } } as any;
    const { kv, store } = makeKV();
    const env = { CACHE: kv } as unknown as Env;

    expect(await getDataSourceId(notion, "db-1", env)).toBe("ds-1");
    expect(await getDataSourceId(notion, "db-1", env)).toBe("ds-1");
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(store.get("notion_dsid:db-1")).toBe("ds-1");

    // New isolate (memory cleared) → KV hit, still no Notion call
    clearDataSourceIdMemory();
    expect(await getDataSourceId(notion, "db-1", env)).toBe("ds-1");
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
});
