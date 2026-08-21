/** R2 key layout (one prefix per item) and the matching public file URL. */
import type { Variant } from "./types";

export function variantKey(id: string, variant: Variant, ext: string): string {
  return `media/${id}/${variant}.${ext}`;
}

export function fileUrl(id: string, variant: Variant): string {
  return `/api/galleri/file/${id}/${variant}`;
}
