import { z } from "zod";
import {
  FURNITURE_LABELS,
  FURNITURE_NAMES,
  MATERIALS,
  furnitureItemSchema,
  type FurnitureItem,
  type FurnitureLabel,
} from "./furniture";
import { roomSizeSchema, type RoomSize } from "./room";

/**
 * The room as the rest of the app sees it: its size and the furniture in it. The 3D builder and
 * the layout generator both start from this, and need nothing else.
 *
 * It has no positions. A piece is identified by its place in `furniture`, which does not change
 * once the description is made, so a layout can say "piece 3" and everyone means the same piece.
 */
export const roomDescriptionSchema = z.object({
  room: roomSizeSchema,
  furniture: z.array(furnitureItemSchema).min(1),
});

export type RoomDescription = z.infer<typeof roomDescriptionSchema>;

/** A valid room description, or everything that is wrong with the input, one sentence for each problem. */
export type RoomDescriptionResult =
  | { ok: true; description: RoomDescription }
  | { ok: false; problems: string[] };

type Issue = z.core.$ZodIssue;

const DIMENSION_NAMES: Record<string, string> = {
  width_m: "width",
  length_m: "length",
  height_m: "height",
};

const SIZE_NAMES: Record<string, string> = {
  width_cm: "width",
  depth_cm: "depth",
  height_cm: "height",
};

/** Nothing was given: absent, null or not a number. A wrong value is a different problem. */
const isMissing = (value: unknown) =>
  value === undefined || value === null || (typeof value === "number" && Number.isNaN(value));

/** The value the issue is about, found in the input again because the issue does not carry it. */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let value = input;
  for (const key of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<PropertyKey, unknown>)[key];
  }
  return value;
}

/** What is wrong with a number: `subject` is how it is called, such as "the room width". */
function describeNumber(issue: Issue, value: unknown, subject: string, unit: string): string {
  if (isMissing(value)) return `${subject} is missing.`;
  if (issue.code === "too_small") {
    return `${subject} must be at least ${issue.minimum} ${unit} (it is ${value} ${unit}).`;
  }
  if (issue.code === "too_big") {
    return `${subject} must be at most ${issue.maximum} ${unit} (it is ${value} ${unit}).`;
  }
  return `${subject} must be a number.`;
}

/** Which piece a problem is about, for the user: its number in the list, and its type when that is known. */
function itemPrefix(input: unknown, index: number): string {
  const label = valueAt(input, ["furniture", index, "label"]);
  const known = typeof label === "string" && (FURNITURE_LABELS as readonly string[]).includes(label);
  const name = known ? ` (${FURNITURE_NAMES[label as FurnitureLabel]})` : "";
  return `Furniture item ${index + 1}${name}: `;
}

function describeItemIssue(issue: Issue, input: unknown, index: number, field: string): string {
  const prefix = itemPrefix(input, index);
  const value = valueAt(input, issue.path);

  switch (field) {
    case "label":
    case "material": {
      const [subject, allowed] =
        field === "label" ? ["type", FURNITURE_LABELS] : ["material", MATERIALS];
      if (isMissing(value)) return `${prefix}the ${subject} is missing.`;
      const given = typeof value === "string" ? `the ${subject} "${value}" is not supported` : `the ${subject} is not valid`;
      return `${prefix}${given}; use one of: ${allowed.join(", ")}.`;
    }
    case "color":
      if (isMissing(value)) return `${prefix}the colour is missing.`;
      if (issue.code === "custom") return `${prefix}the colour is empty.`;
      return `${prefix}the colour must be text.`;
    case "width_cm":
    case "depth_cm":
    case "height_cm":
      return prefix + describeNumber(issue, value, `the ${SIZE_NAMES[field]}`, "cm");
    default:
      return prefix + issue.message;
  }
}

/** Says in a sentence what one problem found by the schema means, using the input to tell "missing" from "wrong". */
function describeIssue(issue: Issue, input: unknown): string {
  const [section, index, field] = issue.path;
  const value = valueAt(input, issue.path);

  if (section === undefined) {
    return isMissing(input)
      ? "There is no room description."
      : "A room description must be an object with a room size and a furniture list.";
  }

  if (section === "room") {
    if (index === undefined) {
      return isMissing(value)
        ? "The room size is missing."
        : "The room size must be an object with a width, a length and a height.";
    }
    const name = DIMENSION_NAMES[String(index)] ?? String(index);
    return describeNumber(issue, value, `The room ${name}`, "m");
  }

  if (section === "furniture") {
    if (index === undefined) {
      if (isMissing(value)) return "The furniture list is missing.";
      if (issue.code === "too_small") {
        return "The furniture list is empty. Add at least one piece of furniture.";
      }
      return "The furniture list must be a list of pieces.";
    }
    if (typeof index === "number") {
      if (field === undefined) {
        return isMissing(value)
          ? `Furniture item ${index + 1} is missing.`
          : `Furniture item ${index + 1} must be an object with a type, a size, a colour and a material.`;
      }
      return describeItemIssue(issue, input, index, String(field));
    }
  }

  return issue.message;
}

/**
 * Checks a room description that comes from outside, such as JSON that was saved or sent in a
 * request. On success the result is a clean copy, with only the fields of the schema. It never
 * throws: whatever is wrong is returned as problems that can be shown as they are.
 */
export function parseRoomDescription(input: unknown): RoomDescriptionResult {
  const result = roomDescriptionSchema.safeParse(input);
  if (result.success) return { ok: true, description: result.data };

  return { ok: false, problems: result.error.issues.map((issue) => describeIssue(issue, input)) };
}

/**
 * Makes the room description from a confirmed room size and furniture list, if they are complete.
 * The parameters accept incomplete data on purpose: this is where a missing size is caught.
 * The description is a snapshot, so changing the list afterwards does not change it.
 */
export function createRoomDescription(
  room: Partial<RoomSize> | null | undefined,
  furniture: readonly Partial<FurnitureItem>[] | null | undefined,
): RoomDescriptionResult {
  return parseRoomDescription({ room, furniture });
}
