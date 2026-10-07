import { describe, expect, it } from "vitest";
import {
  FURNITURE_LABELS,
  FURNITURE_NAMES,
  ITEM_SIZE_LIMITS,
  MATERIALS,
  MATERIAL_NAMES,
  TYPICAL_ITEMS,
  UNKNOWN_COLOR,
  furnitureItemSchema,
  parseItemSize,
  typicalItem,
} from "./furniture";

describe("typical items", () => {
  it.each(FURNITURE_LABELS)("%s: a typical piece passes the same validation as one from the AI", (label) => {
    expect(furnitureItemSchema.safeParse(typicalItem(label)).success).toBe(true);
  });

  it.each(FURNITURE_LABELS)("%s: its typical size is within what the user may type", (label) => {
    const { width_cm, depth_cm, height_cm } = TYPICAL_ITEMS[label];

    for (const size of [width_cm, depth_cm, height_cm]) {
      expect(size).toBeGreaterThanOrEqual(ITEM_SIZE_LIMITS.min);
      expect(size).toBeLessThanOrEqual(ITEM_SIZE_LIMITS.max);
    }
  });

  it("has the type, a typical size and material, and an unknown colour", () => {
    expect(typicalItem("sofa")).toEqual({
      label: "sofa",
      width_cm: 200,
      depth_cm: 90,
      height_cm: 85,
      material: "fabric",
      color: UNKNOWN_COLOR,
    });
  });

  it("gives believable proportions: a bookshelf is tall and shallow, a rug is flat", () => {
    expect(typicalItem("bookshelf").height_cm).toBeGreaterThan(typicalItem("bookshelf").width_cm);
    expect(typicalItem("bookshelf").depth_cm).toBeLessThan(typicalItem("bookshelf").width_cm);
    expect(typicalItem("rug").height_cm).toBeLessThanOrEqual(2);
    expect(typicalItem("bed").depth_cm).toBeGreaterThan(typicalItem("bed").width_cm);
  });
});

describe("names for the user", () => {
  it("has a readable name for every type and material", () => {
    for (const label of FURNITURE_LABELS) expect(FURNITURE_NAMES[label]).toMatch(/^[A-Z]/);
    for (const material of MATERIALS) expect(MATERIAL_NAMES[material]).toMatch(/^[A-Z]/);
  });
});

describe("parseItemSize", () => {
  it.each([
    ["85", 85],
    ["85.5", 85.5],
    ["85,5", 85.5],
    [" 200 ", 200],
    ["1", 1],
    ["1000", 1000],
  ])("reads %j as %j cm", (text, value) => {
    expect(parseItemSize("width", text)).toEqual({ ok: true, value });
  });

  it.each([
    ["width", "", "Enter the width in cm."],
    ["depth", "  ", "Enter the depth in cm."],
    ["height", "tall", "Height must be a number, for example 85."],
    ["width", "80 cm", "Width must be a number, for example 85."],
    ["width", "-5", "Width must be a number, for example 85."],
    ["depth", "0", "Depth must be between 1 and 1000 cm."],
    ["depth", "0.5", "Depth must be between 1 and 1000 cm."],
    ["height", "1001", "Height must be between 1 and 1000 cm."],
    ["width", "5000", "Width must be between 1 and 1000 cm."],
  ] as const)("rejects %s %j: %s", (dimension, text, message) => {
    expect(parseItemSize(dimension, text)).toEqual({ ok: false, message });
  });
});
