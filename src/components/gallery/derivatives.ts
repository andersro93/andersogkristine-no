/**
 * Browser-side derivatives. Images: decode once (EXIF orientation applied),
 * draw a ≤2048px "display" and a ≤480px "thumb". Videos: grab a poster frame.
 * WebP when the browser can encode it, otherwise JPEG (Safari).
 */
export const THUMB_EDGE = 480;
export const DISPLAY_EDGE = 2048;

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decodeImage(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function fit(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  };
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", 0.82);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", 0.85);
  if (!jpeg) throw new Error("Kunne ikke behandle bildet.");
  return jpeg;
}

function draw(
  source: CanvasImageSource,
  w: number,
  h: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunne ikke behandle bildet.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

export async function makeImageDerivatives(
  file: File,
): Promise<{ thumb: Blob; display: Blob; width: number; height: number }> {
  const decoded = await decodeImage(file);
  try {
    const d = fit(decoded.width, decoded.height, DISPLAY_EDGE);
    const displayCanvas = draw(decoded.source, d.w, d.h);
    const t = fit(d.w, d.h, THUMB_EDGE);
    const thumbCanvas = draw(displayCanvas, t.w, t.h);
    const [display, thumb] = await Promise.all([
      encode(displayCanvas),
      encode(thumbCanvas),
    ]);
    return { thumb, display, width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
  }
}

export async function makeVideoPoster(file: File): Promise<{
  poster: Blob | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = url;
  const cleanup = () => {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("metadata"));
      setTimeout(() => reject(new Error("timeout")), 8000);
    });
    const width = video.videoWidth || null;
    const height = video.videoHeight || null;
    const durationMs = Number.isFinite(video.duration)
      ? Math.round(video.duration * 1000)
      : null;
    let poster: Blob | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("seek"));
        video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
        setTimeout(() => reject(new Error("timeout")), 5000);
      });
      if (width && height) {
        const t = fit(width, height, THUMB_EDGE);
        poster = await encode(draw(video, t.w, t.h));
      }
    } catch {
      poster = null;
    }
    return { poster, width, height, durationMs };
  } catch {
    return { poster: null, width: null, height: null, durationMs: null };
  } finally {
    cleanup();
  }
}
