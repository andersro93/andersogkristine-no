import { describe, expect, test } from "bun:test";
import { createFakeD1, readMigration } from "./d1";
import { createFakeR2 } from "./r2";

describe("fake D1", () => {
  test("applies the real migration and round-trips a row", async () => {
    const db = createFakeD1(readMigration());
    await db
      .prepare(
        "INSERT INTO media (id, kind, created_at, device_id) VALUES (?, ?, ?, ?)",
      )
      .bind("a", "image", 1000, "dev-1")
      .run();
    const row = await db
      .prepare("SELECT id, kind, status FROM media WHERE id = ?")
      .bind("a")
      .first<{ id: string; kind: string; status: string }>();
    expect(row).toEqual({ id: "a", kind: "image", status: "uploading" });
    const all = await db.prepare("SELECT id FROM media").all<{ id: string }>();
    expect(all.results).toEqual([{ id: "a" }]);
    expect(all.success).toBe(true);
  });

  test("throws on undefined binds like real D1", () => {
    const db = createFakeD1(readMigration());
    expect(() =>
      db.prepare("SELECT 1 WHERE 1 = ?").bind(undefined as unknown as null),
    ).toThrow(/D1_TYPE_ERROR/);
  });

  test("enforces the CHECK constraints", async () => {
    const db = createFakeD1(readMigration());
    await expect(
      db
        .prepare(
          "INSERT INTO media (id, kind, created_at, device_id) VALUES (?, ?, ?, ?)",
        )
        .bind("b", "audio", 1, "dev")
        .run(),
    ).rejects.toThrow();
  });
});

describe("fake R2", () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  test("put from a stream, get whole object", async () => {
    const r2 = createFakeR2();
    const stream = new Blob([bytes]).stream();
    const put = await r2.put("k", stream, {
      httpMetadata: { contentType: "image/webp" },
    });
    expect(put?.size).toBe(10);
    const obj = await r2.get("k");
    expect(obj).not.toBeNull();
    const found = obj as NonNullable<typeof obj>;
    expect(new Uint8Array(await found.arrayBuffer())).toEqual(bytes);
    const h = new Headers();
    found.writeHttpMetadata(h);
    expect(h.get("Content-Type")).toBe("image/webp");
    expect(found.httpEtag.startsWith('"')).toBe(true);
  });

  test("range by object and by Headers", async () => {
    const r2 = createFakeR2();
    await r2.put("k", bytes);
    const a = await r2.get("k", { range: { offset: 2, length: 3 } });
    expect(a).not.toBeNull();
    const rangeA = a as NonNullable<typeof a>;
    expect(new Uint8Array(await rangeA.arrayBuffer())).toEqual(
      new Uint8Array([2, 3, 4]),
    );
    expect(rangeA.range).toEqual({ offset: 2, length: 3 });
    const b = await r2.get("k", {
      range: new Headers({ Range: "bytes=0-1" }),
    });
    expect(b).not.toBeNull();
    const rangeB = b as NonNullable<typeof b>;
    expect(new Uint8Array(await rangeB.arrayBuffer())).toEqual(
      new Uint8Array([0, 1]),
    );
    const c = await r2.get("k", { range: new Headers({ Range: "bytes=-2" }) });
    expect(c).not.toBeNull();
    const rangeC = c as NonNullable<typeof c>;
    expect(new Uint8Array(await rangeC.arrayBuffer())).toEqual(
      new Uint8Array([8, 9]),
    );
    await expect(
      r2.get("k", { range: new Headers({ Range: "bytes=50-" }) }),
    ).rejects.toThrow();
  });

  test("onlyIf If-None-Match returns a body-less object", async () => {
    const r2 = createFakeR2();
    await r2.put("k", bytes);
    const obj = await r2.get("k");
    expect(obj).not.toBeNull();
    const found = obj as NonNullable<typeof obj>;
    const again = await r2.get("k", {
      onlyIf: new Headers({ "If-None-Match": found.httpEtag }),
    });
    expect(again).not.toBeNull();
    const bodyless = again as NonNullable<typeof again>;
    expect("body" in bodyless).toBe(false);
  });

  test("head, delete, list", async () => {
    const r2 = createFakeR2();
    await r2.put("media/a/thumb.webp", bytes);
    await r2.put("media/a/display.webp", bytes);
    expect((await r2.head("media/a/thumb.webp"))?.size).toBe(10);
    const listed = await r2.list({ prefix: "media/a/" });
    expect(listed.objects.map((o) => o.key).sort()).toEqual([
      "media/a/display.webp",
      "media/a/thumb.webp",
    ]);
    await r2.delete("media/a/thumb.webp");
    expect(await r2.get("media/a/thumb.webp")).toBeNull();
  });
});
