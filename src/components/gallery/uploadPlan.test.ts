import { describe, expect, test } from "bun:test";
import { SIZE_CAPS } from "../../services/gallery/validation";
import {
  backoffMs,
  classifyFile,
  overallProgress,
  planUploadSteps,
  shouldRetry,
} from "./uploadPlan";

describe("classifyFile", () => {
  test("uses the declared type when present", () => {
    expect(
      classifyFile({ name: "a.jpg", type: "image/jpeg", size: 10 }),
    ).toEqual({ ok: true, kind: "image", mime: "image/jpeg" });
    expect(
      classifyFile({ name: "a.MOV", type: "video/quicktime", size: 10 }),
    ).toEqual({ ok: true, kind: "video", mime: "video/quicktime" });
  });
  test("guesses from the extension when the type is empty", () => {
    expect(classifyFile({ name: "IMG_1.HEIC", type: "", size: 10 })).toEqual({
      ok: true,
      kind: "image",
      mime: "image/heic",
    });
    expect(classifyFile({ name: "clip.mp4", type: "", size: 10 })).toEqual({
      ok: true,
      kind: "video",
      mime: "video/mp4",
    });
  });
  test("rejects unsupported types and oversize files with a Norwegian message", () => {
    const gif = classifyFile({ name: "a.gif", type: "image/gif", size: 10 });
    expect(gif.ok).toBe(false);
    const big = classifyFile({
      name: "a.mp4",
      type: "video/mp4",
      size: SIZE_CAPS.originalVideo + 1,
    });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toContain("80 MB");
    expect(classifyFile({ name: "x.bin", type: "", size: 1 }).ok).toBe(false);
  });
});

test("planUploadSteps", () => {
  expect(planUploadSteps("image", false)).toEqual([
    "thumb",
    "display",
    "original",
  ]);
  expect(planUploadSteps("video", true)).toEqual(["thumb", "original"]);
  expect(planUploadSteps("video", false)).toEqual(["original"]);
});

test("backoffMs grows and caps", () => {
  expect(backoffMs(0)).toBe(500);
  expect(backoffMs(1)).toBe(1000);
  expect(backoffMs(2)).toBe(2000);
  expect(backoffMs(5)).toBe(4000);
});

test("shouldRetry: network and 5xx yes, 4xx no", () => {
  expect(shouldRetry(0)).toBe(true);
  expect(shouldRetry(502)).toBe(true);
  expect(shouldRetry(413)).toBe(false);
  expect(shouldRetry(409)).toBe(false);
});

test("overallProgress is byte-weighted", () => {
  const steps = ["thumb", "display", "original"] as const;
  const sizes = { thumb: 10, display: 40, original: 50 };
  expect(overallProgress([...steps], sizes, null, 0)).toBe(0);
  expect(overallProgress([...steps], sizes, "thumb", 0.5)).toBeCloseTo(0.05);
  expect(overallProgress([...steps], sizes, "display", 0.5)).toBeCloseTo(0.3);
  expect(overallProgress([...steps], sizes, "original", 1)).toBeCloseTo(1);
  expect(overallProgress([...steps], {}, "thumb", 0.5)).toBe(0);
});
