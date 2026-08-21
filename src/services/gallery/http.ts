/** Small request helpers shared by the /api/galleri handlers. */
import { isUuid } from "./validation";

/** The browser's per-device uuid (localStorage). Required on writes, optional on reads. */
export function getDeviceId(request: Request): string | null {
  const v = request.headers.get("x-device-id");
  return isUuid(v) ? v : null;
}

/** `gallery_upload` flag (middleware puts flags on locals; missing flag = open). */
export function uploadsOpen(
  locals: { flags?: Record<string, boolean> } | undefined,
): boolean {
  return locals?.flags?.gallery_upload !== false;
}

/** An `uploading` row older than this is considered stuck (admin count only). */
export const STUCK_AFTER_MS = 60 * 60 * 1000;
