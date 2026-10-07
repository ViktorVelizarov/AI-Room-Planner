import { readDecimal, type NumberCheck } from "./numbers";

/** The size of the room in metres. */
export type RoomSize = { width_m: number; length_m: number; height_m: number };

export type RoomDimension = "width" | "length" | "height";

/** The range each dimension may have, in metres. Both ends are allowed. */
export const ROOM_LIMITS: Record<RoomDimension, { min: number; max: number }> = {
  width: { min: 1, max: 20 },
  length: { min: 1, max: 20 },
  height: { min: 2, max: 5 },
};

/** What the size fields start with: a typical living room. */
export const DEFAULT_ROOM_SIZE: RoomSize = { width_m: 4, length_m: 5, height_m: 2.5 };

const NAMES: Record<RoomDimension, string> = {
  width: "Width",
  length: "Length",
  height: "Height",
};

export type DimensionCheck = NumberCheck;

/**
 * Reads what the user typed for one dimension. Accepts a decimal point or a decimal comma
 * ("3.5" or "3,5"). A failure carries a message to show next to the field.
 */
export function parseDimension(dimension: RoomDimension, text: string): DimensionCheck {
  const name = NAMES[dimension];
  const { min, max } = ROOM_LIMITS[dimension];
  const typed = text.trim();

  if (typed === "") {
    return { ok: false, message: `Enter the ${name.toLowerCase()} in metres.` };
  }
  const value = readDecimal(typed);
  if (value === null) {
    return { ok: false, message: `${name} must be a number, for example 4.5.` };
  }
  if (value < min || value > max) {
    return { ok: false, message: `${name} must be between ${min} and ${max} m.` };
  }
  return { ok: true, value };
}

/** A length in metres for display: at most 2 decimals, no trailing zeros. */
export function formatMetres(metres: number): string {
  return String(Number(metres.toFixed(2)));
}
