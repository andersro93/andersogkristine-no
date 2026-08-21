/**
 * D1 repository for the gallery. All SQL for the `media` table lives here.
 *
 * D1 quirks honoured: only `?` placeholders, every bind `?? null` (D1 rejects
 * `undefined`), integers for timestamps. Feed ordering is keyset on
 * (ready_at DESC, id DESC) so pagination and `since` polling never miss a
 * row that was created earlier but completed later.
 */
import { fileUrl } from "./keys";
import type {
  GalleryItem,
  HiddenBy,
  MediaKind,
  MediaRow,
  Variant,
} from "./types";

export interface CreateItemInput {
  id: string;
  kind: MediaKind;
  createdAt: number;
  name: string | null;
  deviceId: string;
  ipHash: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  originalMime: string;
}

export async function createItem(
  db: D1Database,
  input: CreateItemInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO media
         (id, kind, status, created_at, uploader_name, device_id, ip_hash,
          width, height, duration_ms, original_mime)
       VALUES (?, ?, 'uploading', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.kind,
      input.createdAt,
      input.name ?? null,
      input.deviceId,
      input.ipHash ?? null,
      input.width ?? null,
      input.height ?? null,
      input.durationMs ?? null,
      input.originalMime,
    )
    .run();
}

export async function getItem(
  db: D1Database,
  id: string,
): Promise<MediaRow | null> {
  return db
    .prepare("SELECT * FROM media WHERE id = ?")
    .bind(id)
    .first<MediaRow>();
}

export async function setVariant(
  db: D1Database,
  id: string,
  variant: Variant,
  key: string,
  bytes: number,
): Promise<void> {
  if (variant === "original") {
    await db
      .prepare(
        "UPDATE media SET original_key = ?, original_bytes = ? WHERE id = ?",
      )
      .bind(key, bytes, id)
      .run();
    return;
  }
  // `variant` is an enum, so the column name is safe to interpolate.
  const column = variant === "thumb" ? "thumb_key" : "display_key";
  await db
    .prepare(`UPDATE media SET ${column} = ? WHERE id = ?`)
    .bind(key, id)
    .run();
}

/**
 * Undo `setVariant`: null out the column for a variant that was stored and
 * then rejected (put failed, size mismatch, sniff mismatch), so D1 never
 * references an R2 object that was deleted.
 */
export async function clearVariant(
  db: D1Database,
  id: string,
  variant: Variant,
): Promise<void> {
  if (variant === "original") {
    await db
      .prepare(
        "UPDATE media SET original_key = NULL, original_bytes = NULL WHERE id = ?",
      )
      .bind(id)
      .run();
    return;
  }
  // `variant` is an enum, so the column name is safe to interpolate.
  const column = variant === "thumb" ? "thumb_key" : "display_key";
  await db
    .prepare(`UPDATE media SET ${column} = NULL WHERE id = ?`)
    .bind(id)
    .run();
}

/** Flip to ready exactly once; later calls are no-ops (ready_at is the feed key). */
export async function markReady(
  db: D1Database,
  id: string,
  readyAt: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE media SET status = 'ready', ready_at = ? WHERE id = ? AND status = 'uploading'",
    )
    .bind(readyAt, id)
    .run();
}

export interface FeedQuery {
  limit: number;
  cursor?: { readyAt: number; id: string } | null;
  since?: number | null;
  deviceId?: string | null;
  includeHidden?: boolean;
}

export async function listFeed(
  db: D1Database,
  q: FeedQuery,
): Promise<MediaRow[]> {
  const where: string[] = ["status = 'ready'"];
  const args: (string | number)[] = [];
  if (!q.includeHidden) where.push("hidden_at IS NULL");
  if (q.deviceId) {
    where.push("device_id = ?");
    args.push(q.deviceId);
  }
  if (q.since !== null && q.since !== undefined) {
    where.push("ready_at > ?");
    args.push(q.since);
  }
  if (q.cursor) {
    where.push("(ready_at < ? OR (ready_at = ? AND id < ?))");
    args.push(q.cursor.readyAt, q.cursor.readyAt, q.cursor.id);
  }
  args.push(q.limit);
  const sql = `SELECT * FROM media WHERE ${where.join(" AND ")} ORDER BY ready_at DESC, id DESC LIMIT ?`;
  const res = await db
    .prepare(sql)
    .bind(...args)
    .all<MediaRow>();
  return res.results;
}

export async function setHidden(
  db: D1Database,
  id: string,
  by: HiddenBy,
  at: number,
): Promise<void> {
  await db
    .prepare("UPDATE media SET hidden_at = ?, hidden_by = ? WHERE id = ?")
    .bind(at, by, id)
    .run();
}

export async function clearHidden(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE media SET hidden_at = NULL, hidden_by = NULL WHERE id = ?")
    .bind(id)
    .run();
}

/** Rows created after `sinceMs` for a device or IP hash (quota). */
export async function countRecent(
  db: D1Database,
  field: "device_id" | "ip_hash",
  value: string,
  sinceMs: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM media WHERE ${field} = ? AND created_at > ?`,
    )
    .bind(value, sinceMs)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Uploads that never completed (phone died mid-upload). Shown to admins only. */
export async function countStuck(
  db: D1Database,
  olderThanMs: number,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM media WHERE status = 'uploading' AND created_at < ?",
    )
    .bind(olderThanMs)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Public API shape. Device ids and IP hashes never leave the server. */
export function toGalleryItem(
  row: MediaRow,
  opts: { deviceId?: string | null; admin?: boolean },
): GalleryItem {
  return {
    id: row.id,
    kind: row.kind,
    name: row.uploader_name,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    hasOriginal: row.original_key !== null,
    thumbUrl: row.thumb_key ? fileUrl(row.id, "thumb") : null,
    displayUrl: row.display_key ? fileUrl(row.id, "display") : null,
    originalUrl: row.original_key ? fileUrl(row.id, "original") : null,
    mine: !!opts.deviceId && row.device_id === opts.deviceId,
    hiddenAt: opts.admin ? row.hidden_at : null,
  };
}
