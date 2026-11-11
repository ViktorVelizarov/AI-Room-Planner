import { whyNoLayoutIsPossible, type Pose } from "../shared/layout";
import {
  LAYOUT_STYLES,
  STYLE_IDEAS,
  isDifferentEnough,
  piecesInOwnPlaces,
  piecesNeededInOwnPlaces,
  type LayoutStyle,
  type MadeLayout,
} from "../shared/layout-styles";
import type { RoomDescription } from "../shared/room-description";
import { generateLayoutWithGemini } from "./gemini";
import { LayoutError, LayoutOverlapError, RoomTooFullError, generateLayout } from "./layout";
import type { GenerateLayoutFn } from "./types";

/** Why a style has no layout. */
export type StyleFailure =
  /** The answer was not a usable layout twice in a row. */
  | { code: "invalid_answer"; reasons: string[] }
  /** The layout still had pieces overlapping or through a wall after the app tried to fix it. */
  | { code: "layout_has_overlaps"; problems: string[] }
  /** The layout was fine, but too much like the others: fewer than half of its pieces are in places of their own. */
  | { code: "too_similar"; own: number; needed: number; pieces: number }
  /** The call itself failed (network, a bad key, the session's limit of calls). What it was is left to the caller to tell. */
  | { code: "error"; error: unknown };

/** What was made for one style: a layout (`described` says whether its description is the model's, and not the idea of the style), or why there is none. */
export type StyleOutcome =
  | { style: LayoutStyle; ok: true; description: string; described: boolean; poses: Pose[]; adjusted: number[] }
  | { style: LayoutStyle; ok: false; failure: StyleFailure };

type Made = Extract<StyleOutcome, { ok: true }>;

/** One style: asks for the layout, and says what came of it. It never throws. */
async function attempt(
  description: RoomDescription,
  style: LayoutStyle,
  generate: GenerateLayoutFn,
  alongside: readonly LayoutStyle[],
  avoid: readonly MadeLayout[],
): Promise<StyleOutcome> {
  try {
    const result = await generateLayout(description, generate, { style, alongside, avoid });
    // A layout always has a description: the model's if its answer had a usable one, else the idea of the style.
    return { style, ok: true, description: result.description ?? STYLE_IDEAS[style], described: result.description !== undefined, poses: result.poses, adjusted: result.adjusted };
  } catch (error) {
    if (error instanceof LayoutError) return { style, ok: false, failure: { code: "invalid_answer", reasons: error.reasons } };
    if (error instanceof LayoutOverlapError) return { style, ok: false, failure: { code: "layout_has_overlaps", problems: error.problems } };
    return { style, ok: false, failure: { code: "error", error } };
  }
}

/**
 * Makes a layout of the furniture of a room in each of the given styles (US-21), at the same time, one
 * model request for each (`generateLayout` retries an answer that is not usable once). Each style
 * succeeds or fails on its own, so a layout that fails does not take the others with it. The outcomes
 * are in the order of `styles`. It throws a RoomTooFullError, without asking the model anything, if the
 * room cannot hold the furniture.
 *
 * The layouts have to be clearly different from each other (AC3): at least half of the pieces of each
 * are in a different place than in every other (`isDifferentEnough`). The styles are asked for without
 * seeing each other, so this is checked afterwards, and a layout that is too much like the others is
 * made once more, told where the others put the pieces (the weakest one, which has the fewest pieces
 * in places of its own; the later style if they are equal). One that is still too much like the others
 * after that has failed, with `too_similar`. `existing` are layouts that are already made, such as the
 * two that worked when one style is made again: the new layouts have to differ from them, and they are
 * never changed. They are shown to the model from the first try, so there is no second one for that.
 */
export async function generateLayouts(
  description: RoomDescription,
  styles: readonly LayoutStyle[],
  generate: GenerateLayoutFn = generateLayoutWithGemini,
  existing: readonly MadeLayout[] = [],
): Promise<StyleOutcome[]> {
  const tooFull = whyNoLayoutIsPossible(description);
  if (tooFull) throw new RoomTooFullError(tooFull);

  const outcomes = new Map<LayoutStyle, StyleOutcome>();
  const first = await Promise.all(
    styles.map((style) =>
      attempt(description, style, generate, styles.filter((other) => other !== style), existing),
    ),
  );
  for (const outcome of first) outcomes.set(outcome.style, outcome);

  let mayMakeAgain = existing.length === 0;
  for (;;) {
    const fresh = [...outcomes.values()].filter((outcome): outcome is Made => outcome.ok);
    // The layouts that this one is compared with: all the others, those already made and those that were just made.
    const othersOf = (layout: Made): MadeLayout[] => [
      ...existing,
      ...fresh.filter((other) => other !== layout).map(({ style, poses }) => ({ style, poses })),
    ];
    const own = (layout: Made) => piecesInOwnPlaces(layout.poses, othersOf(layout).map((other) => other.poses)).length;
    const weak = fresh.filter((layout) => !isDifferentEnough(layout.poses, othersOf(layout).map((other) => other.poses)));
    if (weak.length === 0) break;

    const [worst] = weak.sort((a, b) => own(a) - own(b) || LAYOUT_STYLES.indexOf(b.style) - LAYOUT_STYLES.indexOf(a.style));
    if (mayMakeAgain) {
      mayMakeAgain = false;
      outcomes.set(worst.style, await attempt(description, worst.style, generate, [], othersOf(worst)));
    } else {
      const pieces = worst.poses.length;
      outcomes.set(worst.style, { style: worst.style, ok: false, failure: { code: "too_similar", own: own(worst), needed: piecesNeededInOwnPlaces(pieces), pieces } });
    }
  }

  return styles.map((style) => outcomes.get(style)!);
}
