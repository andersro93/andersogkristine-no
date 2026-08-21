import { describe, expect, test } from "bun:test";
import { celebrateSingleMatch } from "./seatingDelight";

describe("celebrateSingleMatch", () => {
  test("no matches → null", () => {
    expect(celebrateSingleMatch([], new Set())).toBeNull();
  });

  test("multiple matches → null", () => {
    expect(celebrateSingleMatch(["a", "b"], new Set())).toBeNull();
  });

  test("one new match → a Set containing the id", () => {
    const result = celebrateSingleMatch(["a"], new Set());
    expect(result).toEqual(new Set(["a"]));
  });

  test("same id again → null", () => {
    expect(celebrateSingleMatch(["a"], new Set(["a"]))).toBeNull();
  });

  test("a different single id later → celebrates again", () => {
    const result = celebrateSingleMatch(["b"], new Set(["a"]));
    expect(result).toEqual(new Set(["a", "b"]));
  });

  test("does not mutate the input seen set", () => {
    const seen = new Set(["a"]);
    celebrateSingleMatch(["b"], seen);
    expect(seen).toEqual(new Set(["a"]));
  });
});
