/** Resolve the gallery's Workers bindings; null → the feature degrades to 503 / "ikke tilgjengelig". */
export const GALLERY_UNAVAILABLE = {
  error: "Galleriet er ikke tilgjengelig akkurat nå.",
  unavailable: true,
} as const;

export interface GalleryBindings {
  db: D1Database;
  bucket: R2Bucket;
}

export function getGalleryBindings(env?: Env): GalleryBindings | null {
  const db = env?.DB;
  const bucket = env?.GALLERY;
  return db && bucket ? { db, bucket } : null;
}
