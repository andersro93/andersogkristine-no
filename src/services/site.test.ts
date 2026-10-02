import { describe, expect, test } from "bun:test";
import { isSiteClosed } from "./site";

describe("isSiteClosed", () => {
  test("is closed for truthy string values", () => {
    for (const value of ["true", "TRUE", " 1 ", "yes", "on"]) {
      expect(isSiteClosed({ SITE_CLOSED: value } as unknown as Env)).toBe(true);
    }
  });

  test("is open for falsy, unknown or missing values", () => {
    for (const value of ["false", "0", "no", "", "maybe"]) {
      expect(isSiteClosed({ SITE_CLOSED: value } as unknown as Env)).toBe(
        false,
      );
    }
    expect(isSiteClosed({} as Env)).toBe(false);
  });
});
