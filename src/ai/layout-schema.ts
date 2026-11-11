import { z } from "zod";
import { FURNITURE_LABELS, type FurnitureItem } from "../shared/furniture";
import { MAX_LAYOUT_PIECES, normaliseRotation, type Pose } from "../shared/layout";
import { ROOM_LIMITS } from "../shared/room";

/** The farthest from the middle of the floor that anything can be: half of the longest room there can be. */
const REACH_M = Math.max(ROOM_LIMITS.width.max, ROOM_LIMITS.length.max) / 2;

// The descriptions go to the model with the schema, and tell it what each number means.
const layoutEntrySchema = z.object({
  index: z.number().int().min(0).max(MAX_LAYOUT_PIECES - 1).describe("The number of the piece in the list, counting from 0."),
  label: z.enum(FURNITURE_LABELS).describe("The type of the piece, as in the list."),
  x_m: z.number().min(-REACH_M).max(REACH_M).describe("The middle of the piece across the room, in metres from the middle of the floor: negative towards the left wall, positive towards the right wall."),
  z_m: z.number().min(-REACH_M).max(REACH_M).describe("The middle of the piece along the room, in metres from the middle of the floor: negative towards the back wall, positive towards the front wall."),
  rotation_deg: z.number().describe("The way the front of the piece faces, in degrees: 0 the front wall, 90 the right wall, 180 the back wall, 270 the left wall."),
});

/** The shape of the model's whole answer: one entry for each piece of the list, and the idea of the layout in a sentence or two. */
export const layoutAnswerSchema = z.object({
  description: z.string().optional().describe("The idea of this layout in one or two plain sentences, for the person whose room it is."),
  pieces: z.array(layoutEntrySchema),
});

/**
 * What an answer is checked with: the same, except that a description that is not text (a number, or
 * null) is not held against the answer. It is left out, and the layout gets the idea of its style.
 */
const acceptedAnswerSchema = layoutAnswerSchema.extend({ description: z.unknown().optional() });

/** The most characters of a description that is used: a sentence or two. */
export const MAX_DESCRIPTION_LENGTH = 300;

/**
 * The description of a layout as it is shown, from what the model wrote: on one line, the first two
 * sentences, or the first sentence alone when the two are longer than `MAX_DESCRIPTION_LENGTH`, or
 * `undefined` if there is nothing usable (it is empty, not text, or its first sentence is too long).
 * A description that cannot be used is not worth a second call: the layout gets the idea of its
 * style instead.
 */
export function cleanDescription(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  // A sentence ends at a full stop, a question mark or an exclamation mark that is followed by the next sentence, so "1.5 m" is not cut.
  const sentences = flat.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
  return [2, 1].map((count) => sentences.slice(0, count).join(" ")).find((kept) => kept.length <= MAX_DESCRIPTION_LENGTH);
}

/** The same, with the description required: what a layout in a style is asked for, since the model leaves out what is only optional. */
const describedAnswerSchema = layoutAnswerSchema.extend({
  description: z.string().describe("The idea of this layout in one or two plain sentences, for the person whose room it is."),
});

/**
 * The same schema as plain JSON Schema, for Gemini's `responseJsonSchema`. With `withDescription` the
 * description is required, as it is for a layout in a style; an answer that has none is still accepted.
 */
export function layoutJsonSchema({ withDescription = false }: { withDescription?: boolean } = {}) {
  const schema = z.toJSONSchema(withDescription ? describedAnswerSchema : layoutAnswerSchema);
  delete schema.$schema; // not in the list of keywords Gemini accepts
  return schema;
}

type ParseResult = { ok: true; poses: Pose[]; description?: string } | { ok: false; reason: string };

/** How many problems of an answer are told, so that what is said back to the model stays short. */
const MAX_PROBLEMS_TOLD = 5;
const MAX_REASON_LENGTH = 700;

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * Checks a raw model answer against the list of furniture it was asked about: it must have one
 * entry for each piece, once, with the number and the type of the piece in the list, and nothing
 * else. On success the poses are in the order of the list, whatever the order of the answer. Never
 * throws. A reason is a few sentences that can be told back to the model.
 */
export function parseLayoutAnswer(text: string | undefined, items: readonly Pick<FurnitureItem, "label">[], note?: string): ParseResult {
  const why = note ? ` (${note})` : "";
  if (!text?.trim()) return { ok: false, reason: `empty answer${why}` };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `not valid JSON${why}: ${detail}`.slice(0, MAX_REASON_LENGTH) };
  }

  const result = acceptedAnswerSchema.safeParse(json);
  if (!result.success) return { ok: false, reason: z.prettifyError(result.error).slice(0, MAX_REASON_LENGTH) };

  const problems: string[] = [];
  // The pieces of the list that the answer has an entry for, whether or not it is the right one, and the entries that are right.
  const mentioned = new Set<number>();
  const found = new Map<number, (typeof result.data.pieces)[number]>();
  for (const entry of result.data.pieces) {
    if (entry.index >= items.length) {
      problems.push(`The answer has a piece number ${entry.index}, but the list has ${items.length} ${items.length === 1 ? "piece, number 0" : `pieces, numbers 0 to ${items.length - 1}`}.`);
    } else if (mentioned.has(entry.index)) {
      problems.push(`Piece ${entry.index} is in the answer more than once.`);
    } else {
      mentioned.add(entry.index);
      if (items[entry.index].label === entry.label) found.set(entry.index, entry);
      else problems.push(`Piece ${entry.index} is a ${items[entry.index].label} in the list, but the answer calls it a ${entry.label}.`);
    }
  }
  items.forEach((item, index) => {
    if (!mentioned.has(index)) problems.push(`Piece ${index} (${item.label}) is not in the answer.`);
  });
  if (problems.length > 0) {
    const told = problems.slice(0, MAX_PROBLEMS_TOLD).join(" ");
    return { ok: false, reason: problems.length > MAX_PROBLEMS_TOLD ? `${told} And ${problems.length - MAX_PROBLEMS_TOLD} more.` : told };
  }

  const description = cleanDescription(result.data.description);
  return {
    ok: true,
    poses: items.map((_, index) => {
      const entry = found.get(index)!;
      return { x_m: round(entry.x_m, 3), z_m: round(entry.z_m, 3), rotation_deg: round(normaliseRotation(entry.rotation_deg), 1) };
    }),
    ...(description ? { description } : {}),
  };
}
