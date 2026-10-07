import { z } from "zod";
import { readDecimal, type NumberCheck } from "./numbers";

/** The furniture types the app supports. Each one needs a 3D model in the asset library. */
export const FURNITURE_LABELS = [
  "sofa",
  "armchair",
  "coffee_table",
  "side_table",
  "dining_table",
  "dining_chair",
  "bed",
  "nightstand",
  "dresser",
  "bookshelf",
  "tv_stand",
  "desk",
  "office_chair",
  "floor_lamp",
  "rug",
] as const;

/** Main surface materials. The 3D scene maps each one to a look. */
export const MATERIALS = [
  "fabric",
  "wood",
  "leather",
  "metal",
  "glass",
  "plastic",
  "other",
] as const;

// Plausible real-world range in cm: rejects zero, negative and absurd estimates, but still
// allows the 1-2 cm height of a rug.
const sizeCm = z.number().min(0.1).max(1000);

export const furnitureItemSchema = z.object({
  label: z.enum(FURNITURE_LABELS),
  width_cm: sizeCm,
  depth_cm: sizeCm,
  height_cm: sizeCm,
  // A refine rather than .min(1): a length constraint would end up in the JSON Schema that is
  // sent to Gemini, which does not support it.
  color: z.string().refine((s) => s.trim() !== "", "color must not be empty"),
  material: z.enum(MATERIALS),
});

export type FurnitureLabel = (typeof FURNITURE_LABELS)[number];

/** How each type is written for the user. */
export const FURNITURE_NAMES: Record<FurnitureLabel, string> = {
  sofa: "Sofa",
  armchair: "Armchair",
  coffee_table: "Coffee table",
  side_table: "Side table",
  dining_table: "Dining table",
  dining_chair: "Dining chair",
  bed: "Bed",
  nightstand: "Nightstand",
  dresser: "Dresser",
  bookshelf: "Bookshelf",
  tv_stand: "TV stand",
  desk: "Desk",
  office_chair: "Office chair",
  floor_lamp: "Floor lamp",
  rug: "Rug",
};

export type Material = (typeof MATERIALS)[number];
export type FurnitureItem = z.infer<typeof furnitureItemSchema>;

/** How each material is written for the user. */
export const MATERIAL_NAMES: Record<Material, string> = {
  fabric: "Fabric",
  wood: "Wood",
  leather: "Leather",
  metal: "Metal",
  glass: "Glass",
  plastic: "Plastic",
  other: "Other",
};

/** What a piece of each type is usually like. Used when the user adds a piece the AI missed. */
export const TYPICAL_ITEMS: Record<FurnitureLabel, Omit<FurnitureItem, "label" | "color">> = {
  sofa: { width_cm: 200, depth_cm: 90, height_cm: 85, material: "fabric" },
  armchair: { width_cm: 80, depth_cm: 85, height_cm: 90, material: "fabric" },
  coffee_table: { width_cm: 100, depth_cm: 60, height_cm: 45, material: "wood" },
  side_table: { width_cm: 45, depth_cm: 45, height_cm: 50, material: "wood" },
  dining_table: { width_cm: 160, depth_cm: 90, height_cm: 75, material: "wood" },
  dining_chair: { width_cm: 45, depth_cm: 50, height_cm: 90, material: "wood" },
  bed: { width_cm: 140, depth_cm: 200, height_cm: 90, material: "fabric" },
  nightstand: { width_cm: 40, depth_cm: 40, height_cm: 50, material: "wood" },
  dresser: { width_cm: 80, depth_cm: 45, height_cm: 100, material: "wood" },
  bookshelf: { width_cm: 80, depth_cm: 30, height_cm: 180, material: "wood" },
  tv_stand: { width_cm: 120, depth_cm: 40, height_cm: 50, material: "wood" },
  desk: { width_cm: 120, depth_cm: 60, height_cm: 75, material: "wood" },
  office_chair: { width_cm: 60, depth_cm: 60, height_cm: 100, material: "fabric" },
  floor_lamp: { width_cm: 35, depth_cm: 35, height_cm: 160, material: "metal" },
  rug: { width_cm: 160, depth_cm: 230, height_cm: 1, material: "fabric" },
};

/** The colour of a piece the user added: not known, so the 3D scene uses the model's own look. */
export const UNKNOWN_COLOR = "unknown";

/** A piece of the given type with its typical size, for the user to adjust. */
export function typicalItem(label: FurnitureLabel): FurnitureItem {
  return { label, ...TYPICAL_ITEMS[label], color: UNKNOWN_COLOR };
}

export type ItemDimension = "width" | "depth" | "height";

/** The range a size may have when the user types it, in cm. Both ends are allowed. */
export const ITEM_SIZE_LIMITS = { min: 1, max: 1000 } as const;

/** Reads a size in cm that the user typed. A failure carries a message to show next to the field. */
export function parseItemSize(dimension: ItemDimension, text: string): NumberCheck {
  const name = dimension[0].toUpperCase() + dimension.slice(1);
  const { min, max } = ITEM_SIZE_LIMITS;

  if (text.trim() === "") {
    return { ok: false, message: `Enter the ${dimension} in cm.` };
  }
  const value = readDecimal(text);
  if (value === null) {
    return { ok: false, message: `${name} must be a number, for example 85.` };
  }
  if (value < min || value > max) {
    return { ok: false, message: `${name} must be between ${min} and ${max} cm.` };
  }
  return { ok: true, value };
}
