/** Pure decisions for the upload queue (unit-tested; no DOM). */
import {
  ORIGINAL_MIME_EXT,
  SIZE_CAPS,
} from "../../services/gallery/validation";
import type { MediaKind, Variant } from "./types";

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
};

const MB = 1024 * 1024;

export type Classified =
  | { ok: true; kind: MediaKind; mime: string }
  | { ok: false; error: string };

export function classifyFile(f: {
  name: string;
  type: string;
  size: number;
}): Classified {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = (f.type || EXT_MIME[ext] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const kind: MediaKind | null = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("video/")
      ? "video"
      : null;
  if (!kind || !(mime in ORIGINAL_MIME_EXT[kind])) {
    return {
      ok: false,
      error:
        "Filtypen støttes ikke (bruk JPEG, PNG, WebP, HEIC, MP4 eller MOV).",
    };
  }
  const cap =
    kind === "image" ? SIZE_CAPS.originalImage : SIZE_CAPS.originalVideo;
  if (f.size > cap) {
    return {
      ok: false,
      error:
        kind === "image"
          ? `Bildet er for stort (maks ${Math.round(cap / MB)} MB).`
          : `Videoen er for stor (maks ${Math.round(cap / MB)} MB) – prøv en kortere video.`,
    };
  }
  return { ok: true, kind, mime };
}

/** Small first so the tile shows up fast; the big original last. */
export function planUploadSteps(
  kind: MediaKind,
  hasPoster: boolean,
): Variant[] {
  if (kind === "image") return ["thumb", "display", "original"];
  return hasPoster ? ["thumb", "original"] : ["original"];
}

export function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 4000);
}

export function shouldRetry(status: number): boolean {
  return status === 0 || status >= 500;
}

export function overallProgress(
  steps: Variant[],
  sizes: Partial<Record<Variant, number>>,
  current: Variant | null,
  fraction: number,
): number {
  const total = steps.reduce((sum, s) => sum + (sizes[s] ?? 0), 0);
  if (total === 0 || current === null) return 0;
  let done = 0;
  for (const s of steps) {
    const size = sizes[s] ?? 0;
    if (s === current) {
      done += size * Math.min(Math.max(fraction, 0), 1);
      break;
    }
    done += size;
  }
  return Math.min(done / total, 1);
}
