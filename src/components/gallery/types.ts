import type {
  GalleryItem,
  MediaKind,
  Variant,
} from "../../services/gallery/types";

export type { GalleryItem, MediaKind, Variant };

export type QueueStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "done"
  | "error";

/** One file the user picked, from selection to "visible in the grid". */
export interface QueueItem {
  localId: string;
  file: File;
  kind: MediaKind | null;
  status: QueueStatus;
  stage: Variant | null;
  /** 0..1 across all steps, weighted by bytes */
  progress: number;
  /** Object URL of the local thumb/poster, for the optimistic tile */
  previewUrl: string | null;
  serverId: string | null;
  error: string | null;
  item: GalleryItem | null;
}
