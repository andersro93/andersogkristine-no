/** Thin client for /api/galleri. A 401 means the PIN session expired → reload to /pin. */
import type { GalleryItem, MediaKind, Variant } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function expired(): never {
  window.location.reload();
  throw new ApiError(401, "Logg inn på nytt.");
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) expired();
  if (!res.ok) {
    let message = "Noe gikk galt.";
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const headers = (deviceId: string, extra: Record<string, string> = {}) => ({
  "X-Device-Id": deviceId,
  ...extra,
});

export function createMedia(
  p: {
    kind: MediaKind;
    mime: string;
    bytes: number;
    name: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  },
  deviceId: string,
): Promise<{ id: string }> {
  return fetch("/api/galleri/media", {
    method: "POST",
    headers: headers(deviceId, { "Content-Type": "application/json" }),
    body: JSON.stringify(p),
  }).then((r) => handle<{ id: string }>(r));
}

/** XHR so we get upload progress events (fetch has none). */
export function putVariant(
  id: string,
  variant: Variant,
  blob: Blob,
  contentType: string,
  deviceId: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/galleri/media/${id}/${variant}`);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("X-Device-Id", deviceId);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401) return expired();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      let message = "Opplastingen feilet.";
      try {
        message = JSON.parse(xhr.responseText).error ?? message;
      } catch {
        /* keep default */
      }
      reject(new ApiError(xhr.status, message));
    };
    xhr.onerror = () =>
      reject(new ApiError(0, "Nettverksfeil under opplasting."));
    xhr.onabort = () => reject(new ApiError(0, "Opplastingen ble avbrutt."));
    xhr.send(blob);
  });
}

export function completeMedia(
  id: string,
  deviceId: string,
): Promise<GalleryItem> {
  return fetch(`/api/galleri/media/${id}/complete`, {
    method: "POST",
    headers: headers(deviceId),
  })
    .then((r) => handle<{ item: GalleryItem }>(r))
    .then((b) => b.item);
}

export function fetchFeed(
  p: {
    cursor?: string | null;
    limit?: number;
    since?: number | null;
    mine?: boolean;
    all?: boolean;
  },
  deviceId: string,
): Promise<{
  items: GalleryItem[];
  nextCursor: string | null;
  stuckCount?: number;
}> {
  const q = new URLSearchParams();
  if (p.cursor) q.set("cursor", p.cursor);
  if (p.limit) q.set("limit", String(p.limit));
  if (p.since !== undefined && p.since !== null)
    q.set("since", String(p.since));
  if (p.mine) q.set("mine", "1");
  if (p.all) q.set("all", "1");
  const qs = q.toString();
  return fetch(`/api/galleri/media${qs ? `?${qs}` : ""}`, {
    headers: headers(deviceId),
  }).then((r) =>
    handle<{
      items: GalleryItem[];
      nextCursor: string | null;
      stuckCount?: number;
    }>(r),
  );
}

export function deleteMedia(id: string, deviceId: string): Promise<void> {
  return fetch(`/api/galleri/media/${id}`, {
    method: "DELETE",
    headers: headers(deviceId),
  })
    .then((r) => handle<{ ok: true }>(r))
    .then(() => undefined);
}

export function unhideMedia(id: string, deviceId: string): Promise<void> {
  return fetch(`/api/galleri/media/${id}/unhide`, {
    method: "POST",
    headers: headers(deviceId),
  })
    .then((r) => handle<{ ok: true }>(r))
    .then(() => undefined);
}
