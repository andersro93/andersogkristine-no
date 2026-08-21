import { expect, test } from "bun:test";
import { fileUrl, variantKey } from "./keys";

test("variantKey and fileUrl", () => {
  expect(variantKey("abc", "thumb", "webp")).toBe("media/abc/thumb.webp");
  expect(variantKey("abc", "original", "mov")).toBe("media/abc/original.mov");
  expect(fileUrl("abc", "display")).toBe("/api/galleri/file/abc/display");
});
