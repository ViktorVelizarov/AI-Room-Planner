import { describe, expect, it } from "vitest";
import { readDecimal } from "./numbers";

describe("readDecimal", () => {
  it.each([
    ["4", 4],
    ["3.5", 3.5],
    ["3,5", 3.5],
    [" 12 ", 12],
    ["4.", 4],
    [".5", 0.5],
    [",5", 0.5],
    ["007", 7],
    ["0", 0],
  ])("reads %j as %j", (text, value) => {
    expect(readDecimal(text)).toBe(value);
  });

  it.each(["", "  ", "abc", "4m", "4 m", "-3", "+3", "1e3", "3.5.1", "3,5,1", "0x10", "NaN", "Infinity", "."])(
    "does not read %j",
    (text) => {
      expect(readDecimal(text)).toBeNull();
    },
  );
});
