import { describe, expect, test } from "bun:test";
import {
  allowedMimeFor,
  decodeCursor,
  encodeCursor,
  isUuid,
  isVariant,
  mimeMatchesSniff,
  normalizeContentType,
  resolveRange,
  SIZE_CAPS,
  sanitizeName,
  sizeCapFor,
  sniffMime,
  validateCreatePayload,
} from "./validation";

const base = { kind: "image", mime: "image/jpeg", bytes: 1234 };

describe("validateCreatePayload", () => {
  test("accepts a minimal image payload and normalises optionals", () => {
    const r = validateCreatePayload(base);
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "image",
        mime: "image/jpeg",
        bytes: 1234,
        name: null,
        width: null,
        height: null,
        durationMs: null,
      },
    });
  });
  test("accepts a video with dimensions and duration", () => {
    const r = validateCreatePayload({
      kind: "video",
      mime: "video/quicktime",
      bytes: 10_000_000,
      name: "  Kari ",
      width: 1920,
      height: 1080,
      durationMs: 12_500.7,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("Kari");
      expect(r.value.durationMs).toBe(12501);
    }
  });
  test("rejects non-objects, bad kinds, bad mimes, oversize, mime/kind mismatch", () => {
    expect(validateCreatePayload(null).ok).toBe(false);
    expect(validateCreatePayload({ ...base, kind: "audio" }).ok).toBe(false);
    expect(validateCreatePayload({ ...base, mime: "image/gif" }).ok).toBe(
      false,
    );
    expect(
      validateCreatePayload({ ...base, bytes: SIZE_CAPS.originalImage + 1 }).ok,
    ).toBe(false);
    expect(validateCreatePayload({ ...base, bytes: 0 }).ok).toBe(false);
    expect(validateCreatePayload({ ...base, mime: "video/mp4" }).ok).toBe(
      false,
    );
    const r = validateCreatePayload({
      ...base,
      kind: "video",
      mime: "video/mp4",
      bytes: SIZE_CAPS.originalVideo + 1,
    });
    expect(r.ok).toBe(false);
  });
  test("mime is case/param-insensitive", () => {
    const r = validateCreatePayload({ ...base, mime: "IMAGE/JPEG; charset=x" });
    expect(r.ok && r.value.mime).toBe("image/jpeg");
  });
});

describe("sanitizeName", () => {
  test("trims, strips control chars, caps length, nulls empties", () => {
    expect(sanitizeName("  Ola  Nordmann\n ")).toBe("Ola Nordmann");
    expect(sanitizeName("")).toBeNull();
    expect(sanitizeName(undefined)).toBeNull();
    expect(sanitizeName(42)).toBeNull();
    expect(sanitizeName("x".repeat(100))).toHaveLength(60);
    const withControls = [
      "Ola",
      String.fromCharCode(1),
      String.fromCharCode(2),
      " Nordmann",
      String.fromCharCode(127),
    ].join("");
    expect(sanitizeName(withControls)).toBe("Ola Nordmann");
  });
});

describe("ids, variants, mimes, caps", () => {
  test("isUuid / isVariant", () => {
    expect(isUuid(crypto.randomUUID())).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isVariant("thumb")).toBe(true);
    expect(isVariant("poster")).toBe(false);
  });
  test("allowedMimeFor returns mime→ext maps per kind/variant", () => {
    expect(allowedMimeFor("image", "original")["image/heic"]).toBe("heic");
    expect(allowedMimeFor("video", "original")["video/quicktime"]).toBe("mov");
    expect(allowedMimeFor("video", "original")["image/jpeg"]).toBeUndefined();
    expect(allowedMimeFor("image", "thumb")["image/webp"]).toBe("webp");
    expect(allowedMimeFor("video", "thumb")["image/jpeg"]).toBe("jpg");
    expect(allowedMimeFor("video", "display")).toEqual({});
  });
  test("sizeCapFor", () => {
    expect(sizeCapFor("image", "thumb")).toBe(SIZE_CAPS.thumb);
    expect(sizeCapFor("image", "original")).toBe(SIZE_CAPS.originalImage);
    expect(sizeCapFor("video", "original")).toBe(SIZE_CAPS.originalVideo);
  });
  test("normalizeContentType", () => {
    expect(normalizeContentType("Image/WebP; q=1")).toBe("image/webp");
    expect(normalizeContentType(null)).toBeNull();
    expect(normalizeContentType("   ")).toBeNull();
  });
});

describe("sniffMime / mimeMatchesSniff", () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0,
  ]);
  const ftyp = (brand: string) => {
    const b = new Uint8Array(16);
    b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], 0);
    b.set(new TextEncoder().encode(brand.padEnd(4, " ")), 8);
    return b;
  };
  test("recognises the formats we accept", () => {
    expect(sniffMime(jpeg)).toBe("image/jpeg");
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(webp)).toBe("image/webp");
    expect(sniffMime(ftyp("heic"))).toBe("image/heic");
    expect(sniffMime(ftyp("mif1"))).toBe("image/heic");
    expect(sniffMime(ftyp("isom"))).toBe("video/mp4");
    expect(sniffMime(ftyp("mp42"))).toBe("video/mp4");
    expect(sniffMime(ftyp("qt"))).toBe("video/quicktime");
    expect(sniffMime(new Uint8Array(16))).toBeNull();
    expect(sniffMime(new Uint8Array(3))).toBeNull();
  });
  test("matching is strict for images, family-level for video and heic/heif", () => {
    expect(mimeMatchesSniff("image/jpeg", "image/jpeg")).toBe(true);
    expect(mimeMatchesSniff("image/jpeg", "image/png")).toBe(false);
    expect(mimeMatchesSniff("image/heif", "image/heic")).toBe(true);
    expect(mimeMatchesSniff("video/mp4", "video/quicktime")).toBe(true);
    expect(mimeMatchesSniff("video/quicktime", "video/mp4")).toBe(true);
    expect(mimeMatchesSniff("video/mp4", "image/jpeg")).toBe(false);
    expect(mimeMatchesSniff("image/webp", null)).toBe(false);
  });
});

describe("cursor codec", () => {
  test("round-trips and rejects garbage", () => {
    const id = crypto.randomUUID();
    const c = encodeCursor(1_700_000_000_000, id);
    expect(decodeCursor(c)).toEqual({ readyAt: 1_700_000_000_000, id });
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("abc_def")).toBeNull();
    expect(decodeCursor(`12_${id}x`)).toBeNull();
  });
});

describe("resolveRange", () => {
  test("normalises the three R2Range shapes", () => {
    expect(resolveRange(undefined, 100)).toBeNull();
    expect(resolveRange({ offset: 10, length: 5 }, 100)).toEqual({
      start: 10,
      end: 14,
    });
    expect(resolveRange({ offset: 90 }, 100)).toEqual({ start: 90, end: 99 });
    expect(resolveRange({ suffix: 7 }, 100)).toEqual({ start: 93, end: 99 });
    expect(resolveRange({ offset: 0, length: 500 }, 100)).toEqual({
      start: 0,
      end: 99,
    });
  });
});
