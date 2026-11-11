import { z } from "zod";
import { checkLayoutRequest, MAX_LAYOUT_PIECES } from "./layout";
import { LAYOUT_STYLES, STYLE_NAMES, type LayoutStyle, type MadeLayout } from "./layout-styles";
import type { RoomDescription } from "./room-description";

const styleSchema = z.enum(LAYOUT_STYLES);

// A place is a few metres from the middle of the floor. The limits only keep what goes into a prompt a plain number.
const poseSchema = z.object({
  x_m: z.number().min(-100).max(100),
  z_m: z.number().min(-100).max(100),
  rotation_deg: z.number().min(-3600).max(3600),
});

const bodySchema = z.object({
  description: z.unknown(),
  styles: z.array(styleSchema).min(1).max(LAYOUT_STYLES.length).optional(),
  existing: z
    .array(z.object({ style: styleSchema, poses: z.array(poseSchema).max(MAX_LAYOUT_PIECES) }))
    .max(LAYOUT_STYLES.length - 1)
    .optional(),
});

/** What a request for layouts asks: the room, the styles to make and the layouts that are already made. */
export type LayoutsRequest = {
  description: RoomDescription;
  styles: LayoutStyle[];
  existing: MadeLayout[];
};

export type LayoutsRequestResult = { ok: true; request: LayoutsRequest } | { ok: false; problems: string[] };

const duplicates = (styles: readonly LayoutStyle[]) => styles.length !== new Set(styles).size;

/**
 * Checks what the browser sent to ask for layouts (US-21): a room description, the styles to make (all
 * three if none are given) and, when one style is made again, the layouts that are already made.
 * Anything else in the request is left out of what comes back. Never throws; every problem is a sentence.
 */
export function checkLayoutsRequest(input: unknown): LayoutsRequestResult {
  const shape = bodySchema.safeParse(input);
  if (!shape.success) {
    return { ok: false, problems: shape.error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "The request"}: ${issue.message}.`) };
  }

  const checked = checkLayoutRequest(shape.data.description);
  if (!checked.ok) return checked;

  const styles = shape.data.styles ?? [...LAYOUT_STYLES];
  const existing = shape.data.existing ?? [];
  const problems: string[] = [];
  if (duplicates(styles)) problems.push("A style is asked for more than once.");
  if (duplicates(existing.map(({ style }) => style))) problems.push("A layout that is already made is given more than once for a style.");
  for (const { style } of existing) {
    if (styles.includes(style)) problems.push(`The ${STYLE_NAMES[style]} layout is asked for, and is also given as already made.`);
  }
  const pieces = checked.description.furniture.length;
  for (const { style, poses } of existing) {
    if (poses.length !== pieces) problems.push(`The ${STYLE_NAMES[style]} layout that is already made has ${poses.length} places, and the list has ${pieces} pieces.`);
  }
  if (problems.length > 0) return { ok: false, problems };

  return { ok: true, request: { description: checked.description, styles, existing } };
}
