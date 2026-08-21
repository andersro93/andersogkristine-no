import { beforeEach, describe, expect, test } from "bun:test";
import { createFakeD1, readMigration } from "../../tests/fakes/d1";
import {
  clearHidden,
  countRecent,
  countStuck,
  createItem,
  getItem,
  listFeed,
  markReady,
  setHidden,
  setVariant,
  toGalleryItem,
} from "./db";

const T0 = 1_700_000_000_000;
const ids = Array.from({ length: 5 }, () => crypto.randomUUID());

function input(
  i: number,
  overrides: Partial<Parameters<typeof createItem>[1]> = {},
) {
  return {
    id: ids[i],
    kind: "image" as const,
    createdAt: T0 + i,
    name: `Gjest ${i}`,
    deviceId: "dev-a",
    ipHash: "ip-1",
    width: 100,
    height: 50,
    durationMs: null,
    originalMime: "image/jpeg",
    ...overrides,
  };
}

describe("gallery db", () => {
  let db: D1Database;
  beforeEach(() => {
    db = createFakeD1(readMigration());
  });

  test("create → get → setVariant → markReady", async () => {
    await createItem(db, input(0));
    let row = await getItem(db, ids[0]);
    expect(row?.status).toBe("uploading");
    expect(row?.uploader_name).toBe("Gjest 0");
    expect(row?.ready_at).toBeNull();

    await setVariant(db, ids[0], "thumb", "media/x/thumb.webp", 10);
    await setVariant(db, ids[0], "original", "media/x/original.jpg", 999);
    row = await getItem(db, ids[0]);
    expect(row?.thumb_key).toBe("media/x/thumb.webp");
    expect(row?.original_key).toBe("media/x/original.jpg");
    expect(row?.original_bytes).toBe(999);

    await markReady(db, ids[0], T0 + 100);
    row = await getItem(db, ids[0]);
    expect(row?.status).toBe("ready");
    expect(row?.ready_at).toBe(T0 + 100);

    // idempotent: a second markReady does not move ready_at
    await markReady(db, ids[0], T0 + 200);
    expect((await getItem(db, ids[0]))?.ready_at).toBe(T0 + 100);
  });

  test("nullable fields accept null and missing row returns null", async () => {
    await createItem(
      db,
      input(1, { name: null, ipHash: null, width: null, height: null }),
    );
    const row = await getItem(db, ids[1]);
    expect(row?.uploader_name).toBeNull();
    expect(row?.width).toBeNull();
    expect(await getItem(db, crypto.randomUUID())).toBeNull();
  });

  describe("listFeed", () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await createItem(db, input(i, { deviceId: i % 2 ? "dev-b" : "dev-a" }));
      }
      // ready in order 0..3 (4 stays uploading); 1 hidden
      for (let i = 0; i < 4; i++) await markReady(db, ids[i], T0 + 1000 + i);
      await setHidden(db, ids[1], "admin", T0 + 5000);
    });

    test("newest first, ready only, hidden excluded by default", async () => {
      const rows = await listFeed(db, { limit: 10 });
      expect(rows.map((r) => r.id)).toEqual([ids[3], ids[2], ids[0]]);
    });

    test("includeHidden adds hidden rows, never uploading ones", async () => {
      const rows = await listFeed(db, { limit: 10, includeHidden: true });
      expect(rows.map((r) => r.id)).toEqual([ids[3], ids[2], ids[1], ids[0]]);
    });

    test("keyset cursor pages without gaps or repeats", async () => {
      const page1 = await listFeed(db, { limit: 2 });
      expect(page1.map((r) => r.id)).toEqual([ids[3], ids[2]]);
      const last = page1[page1.length - 1];
      const page2 = await listFeed(db, {
        limit: 2,
        cursor: { readyAt: last.ready_at as number, id: last.id },
      });
      expect(page2.map((r) => r.id)).toEqual([ids[0]]);
    });

    test("ties on ready_at are broken by id DESC", async () => {
      // give ids[0] and ids[2] the same ready_at
      await db
        .prepare("UPDATE media SET ready_at = ? WHERE id IN (?, ?)")
        .bind(T0 + 1000, ids[0], ids[2])
        .run();
      const all = await listFeed(db, { limit: 10 });
      const tied = all.filter((r) => r.ready_at === T0 + 1000).map((r) => r.id);
      expect(tied).toEqual([...tied].sort().reverse());
      const first = await listFeed(db, { limit: 2 });
      const rest = await listFeed(db, {
        limit: 10,
        cursor: { readyAt: first[1].ready_at as number, id: first[1].id },
      });
      expect([...first, ...rest].map((r) => r.id)).toEqual(
        all.map((r) => r.id),
      );
    });

    test("since returns only items readied after the timestamp", async () => {
      const rows = await listFeed(db, { limit: 10, since: T0 + 1002 });
      expect(rows.map((r) => r.id)).toEqual([ids[3]]);
    });

    test("deviceId filters to that device", async () => {
      const rows = await listFeed(db, { limit: 10, deviceId: "dev-a" });
      expect(rows.map((r) => r.id)).toEqual([ids[2], ids[0]]);
    });
  });

  test("setHidden / clearHidden", async () => {
    await createItem(db, input(0));
    await setHidden(db, ids[0], "owner", T0 + 1);
    let row = await getItem(db, ids[0]);
    expect(row?.hidden_at).toBe(T0 + 1);
    expect(row?.hidden_by).toBe("owner");
    await clearHidden(db, ids[0]);
    row = await getItem(db, ids[0]);
    expect(row?.hidden_at).toBeNull();
    expect(row?.hidden_by).toBeNull();
  });

  test("countRecent and countStuck", async () => {
    await createItem(db, input(0, { createdAt: T0 }));
    await createItem(db, input(1, { createdAt: T0 + 10 }));
    await createItem(
      db,
      input(2, { createdAt: T0 + 20, deviceId: "dev-b", ipHash: "ip-2" }),
    );
    expect(await countRecent(db, "device_id", "dev-a", T0 - 1)).toBe(2);
    expect(await countRecent(db, "device_id", "dev-a", T0 + 5)).toBe(1);
    expect(await countRecent(db, "ip_hash", "ip-2", 0)).toBe(1);
    await markReady(db, ids[0], T0 + 30);
    expect(await countStuck(db, T0 + 15)).toBe(1); // ids[1] uploading & older than T0+15
  });

  test("toGalleryItem maps URLs, ownership and admin-only fields", async () => {
    await createItem(db, input(0));
    await setVariant(db, ids[0], "thumb", "media/x/thumb.webp", 1);
    await setVariant(db, ids[0], "display", "media/x/display.webp", 1);
    await markReady(db, ids[0], T0 + 1);
    const row = (await getItem(db, ids[0])) as NonNullable<
      Awaited<ReturnType<typeof getItem>>
    >;

    const mine = toGalleryItem(row, { deviceId: "dev-a" });
    expect(mine).toEqual({
      id: ids[0],
      kind: "image",
      name: "Gjest 0",
      createdAt: T0,
      readyAt: T0 + 1,
      width: 100,
      height: 50,
      durationMs: null,
      hasOriginal: false,
      thumbUrl: `/api/galleri/file/${ids[0]}/thumb`,
      displayUrl: `/api/galleri/file/${ids[0]}/display`,
      originalUrl: null,
      mine: true,
      hiddenAt: null,
    });
    expect(toGalleryItem(row, { deviceId: "dev-z" }).mine).toBe(false);

    await setHidden(db, ids[0], "admin", T0 + 9);
    const hiddenRow = (await getItem(db, ids[0])) as typeof row;
    expect(toGalleryItem(hiddenRow, { admin: false }).hiddenAt).toBeNull();
    expect(toGalleryItem(hiddenRow, { admin: true }).hiddenAt).toBe(T0 + 9);
  });
});
