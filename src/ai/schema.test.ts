import { describe, expect, it } from "vitest";
import { FURNITURE_LABELS, MATERIALS } from "../shared/furniture";
import { UNSUPPORTED_LABEL, detectionJsonSchema } from "./schema";

// Keywords Gemini accepts in `responseJsonSchema` (from the @google/genai typings).
const SUPPORTED_KEYWORDS = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum",
  "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf",
  "properties", "additionalProperties", "required", "propertyOrdering",
]);

/** Paths of every keyword in a schema that Gemini does not support. */
function unsupportedKeywords(schema: unknown, path = "$"): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      found.push(`${path}.${key}`);
    } else if (key === "properties") {
      for (const [name, sub] of Object.entries(value as object)) {
        found.push(...unsupportedKeywords(sub, `${path}.properties.${name}`));
      }
    } else if (key === "anyOf" || key === "oneOf" || key === "prefixItems") {
      (value as unknown[]).forEach((sub, i) =>
        found.push(...unsupportedKeywords(sub, `${path}.${key}[${i}]`)),
      );
    } else if (key === "items" || key === "additionalProperties" || key === "$defs") {
      found.push(...unsupportedKeywords(value, `${path}.${key}`));
    }
  }
  return found;
}

type ItemSchema = {
  required: string[];
  properties: Record<
    string,
    { type?: string; enum?: string[]; minimum?: number; maximum?: number }
  >;
};

describe("detectionJsonSchema", () => {
  const schema = detectionJsonSchema();
  const item = (schema as unknown as { properties: { items: { items: ItemSchema } } })
    .properties.items.items;

  it("only uses keywords that Gemini supports", () => {
    expect(unsupportedKeywords(schema)).toEqual([]);
  });

  it("requires every field of an item", () => {
    expect(item.required).toEqual(
      expect.arrayContaining(["label", "width_cm", "depth_cm", "height_cm", "color", "material"]),
    );
  });

  it("offers the 15 supported labels plus 'other'", () => {
    expect(item.properties.label.enum).toEqual([...FURNITURE_LABELS, UNSUPPORTED_LABEL]);
    expect(FURNITURE_LABELS).toHaveLength(15);
  });

  it("limits the material to the known list", () => {
    expect(item.properties.material.enum).toEqual([...MATERIALS]);
  });

  it("bounds each size", () => {
    for (const field of ["width_cm", "depth_cm", "height_cm"]) {
      expect(item.properties[field]).toMatchObject({ type: "number", minimum: 0.1, maximum: 1000 });
    }
  });
});
