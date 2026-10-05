import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_SIZE, ROOM_LIMITS, formatMetres, parseDimension } from "./room";

const ok = (value: number) => ({ ok: true, value });

describe("parseDimension", () => {
  it.each([
    ["4", 4],
    ["4.5", 4.5],
    ["3,5", 3.5], // a decimal comma, as many keyboards and locales write it
    ["  6  ", 6],
    ["12.25", 12.25],
    ["4.", 4],
    ["007", 7],
  ])("reads %j as %j metres", (text, value) => {
    expect(parseDimension("width", text)).toEqual(ok(value));
  });

  it("reads a number that starts with the decimal point, then checks its range", () => {
    // ".5" is a number (so not "must be a number"), but half a metre is too small
    expect(parseDimension("width", ".5")).toEqual({
      ok: false,
      message: "Width must be between 1 and 20 m.",
    });
  });

  it("accepts the limits themselves", () => {
    expect(parseDimension("width", "1")).toEqual(ok(1));
    expect(parseDimension("width", "20")).toEqual(ok(20));
    expect(parseDimension("length", "1")).toEqual(ok(1));
    expect(parseDimension("length", "20")).toEqual(ok(20));
    expect(parseDimension("height", "2")).toEqual(ok(2));
    expect(parseDimension("height", "5")).toEqual(ok(5));
  });

  it.each(["", "   "])("asks for a value when the field is empty (%j)", (text) => {
    expect(parseDimension("width", text)).toEqual({ ok: false, message: "Enter the width in metres." });
    expect(parseDimension("height", text)).toEqual({ ok: false, message: "Enter the height in metres." });
  });

  it.each(["abc", "4m", "4 m", "1e1", "-3", "+3", "3.5.1", "3,5,1", "0x10", "NaN", "Infinity", "4-5", "."])(
    "says it must be a number for %j",
    (text) => {
      expect(parseDimension("length", text)).toEqual({
        ok: false,
        message: "Length must be a number, for example 4.5.",
      });
    },
  );

  it.each([
    ["width", "0.99", "Width must be between 1 and 20 m."],
    ["width", "20.01", "Width must be between 1 and 20 m."],
    ["width", "0", "Width must be between 1 and 20 m."],
    ["length", "25", "Length must be between 1 and 20 m."],
    ["length", "0,5", "Length must be between 1 and 20 m."],
    ["height", "1.99", "Height must be between 2 and 5 m."],
    ["height", "5.01", "Height must be between 2 and 5 m."],
    ["height", "10", "Height must be between 2 and 5 m."],
  ] as const)("rejects %s %s as out of range", (dimension, text, message) => {
    expect(parseDimension(dimension, text)).toEqual({ ok: false, message });
  });

  it("keeps the messages in step with the limits", () => {
    expect(ROOM_LIMITS).toEqual({
      width: { min: 1, max: 20 },
      length: { min: 1, max: 20 },
      height: { min: 2, max: 5 },
    });
  });
});

describe("DEFAULT_ROOM_SIZE", () => {
  it("is within every limit, so the form can be continued without typing anything", () => {
    expect(parseDimension("width", String(DEFAULT_ROOM_SIZE.width_m)).ok).toBe(true);
    expect(parseDimension("length", String(DEFAULT_ROOM_SIZE.length_m)).ok).toBe(true);
    expect(parseDimension("height", String(DEFAULT_ROOM_SIZE.height_m)).ok).toBe(true);
  });
});

describe("formatMetres", () => {
  it.each([
    [4, "4"],
    [2.5, "2.5"],
    [3.456, "3.46"],
    [3.5, "3.5"],
    [10.004, "10"],
  ])("writes %j as %j", (metres, text) => {
    expect(formatMetres(metres)).toBe(text);
  });
});
