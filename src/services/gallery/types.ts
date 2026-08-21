/** Shared gallery types. Pure — imported by both the Worker and the browser island. */
export type MediaKind = "image" | "video";
export type Variant = "thumb" | "display" | "original";
export type MediaStatus = "uploading" | "ready";
export type HiddenBy = "admin" | "owner";

/** One D1 row in `media` (snake_case = column names). */
export interface MediaRow {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  created_at: number;
  ready_at: number | null;
  uploader_name: string | null;
  device_id: string;
  ip_hash: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  original_key: string | null;
  original_mime: string | null;
  original_bytes: number | null;
  display_key: string | null;
  thumb_key: string | null;
  hidden_at: number | null;
  hidden_by: HiddenBy | null;
}

/** What the API returns to the browser. Never includes device ids or IP hashes. */
export interface GalleryItem {
  id: string;
  kind: MediaKind;
  name: string | null;
  createdAt: number;
  readyAt: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasOriginal: boolean;
  thumbUrl: string | null;
  displayUrl: string | null;
  originalUrl: string | null;
  /** True when the requesting device uploaded it */
  mine: boolean;
  /** Only non-null for admins (hidden items are filtered out otherwise) */
  hiddenAt: number | null;
}
