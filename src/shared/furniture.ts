import { z } from "zod";

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
