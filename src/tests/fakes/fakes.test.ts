import { describe, expect, test } from "bun:test";
import { createFakeD1, readMigration } from "./d1";

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
