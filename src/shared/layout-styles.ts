import type { Pose } from "./layout";

/**
 * The three styles that a room is arranged in (US-21), in the order they are shown. Each is a way of
 * arranging the same furniture, so the three layouts of a room are clearly different from each other.
 */
export const LAYOUT_STYLES = ["spacious", "cosy", "work"] as const;
export type LayoutStyle = (typeof LAYOUT_STYLES)[number];

export const isLayoutStyle = (value: unknown): value is LayoutStyle => LAYOUT_STYLES.includes(value as LayoutStyle);

/** A layout of a room that is already made, in its style: what the layouts that are made after it have to differ from. */
export type MadeLayout = { style: LayoutStyle; poses: readonly Pose[] };

/** The name of a style, as the user sees it. */
export const STYLE_NAMES: Record<LayoutStyle, string> = {
  spacious: "Spacious",
  cosy: "Cosy",
  work: "Work-focused",
};

/**
 * What a style is about, in a sentence for the user. It is the description of a layout when the AI
 * gives none of its own, so that every layout has one.
 */
export const STYLE_IDEAS: Record<LayoutStyle, string> = {
  spacious: "The pieces stand along the walls and the middle of the room stays open, with wide paths between them.",
  cosy: "The pieces are grouped close together around one focal point, so the room feels snug and sociable.",
  work: "A work area with the desk at its heart, kept apart from the rest of the furniture, which stays within reach.",
};

/**
 * How far a piece has to be from where it is in another layout to count as "in a different place": 50
 * cm, between its middles. Turning a piece where it stands is not a different place.
 */
export const MIN_MOVE_M = 0.5;

/** Distances are sums of rounded numbers, so a piece that is moved exactly the minimum may come out a hair under it. */
const TOLERANCE = 1e-9;

/** Whether a piece is in a different place in two layouts (see `MIN_MOVE_M`). */
export const isDifferentPlace = (a: Pose, b: Pose): boolean => Math.hypot(a.x_m - b.x_m, a.z_m - b.z_m) >= MIN_MOVE_M - TOLERANCE;

/** How many pieces of a list of `count` have to be in a place of their own in a layout: at least half of them. */
export const piecesNeededInOwnPlaces = (count: number): number => Math.ceil(count / 2);

/**
 * The pieces of a layout, by their places in the list, that are in a different place from where the same
 * piece is in every one of the `others`. All the layouts are for the same list of furniture, so they
 * have a pose for each piece, in the same order.
 */
export function piecesInOwnPlaces(poses: readonly Pose[], others: readonly (readonly Pose[])[]): number[] {
  return poses.flatMap((pose, index) => (others.every((other) => isDifferentPlace(pose, other[index])) ? [index] : []));
}

/**
 * Whether a layout is clearly different from the others (US-21 AC3): at least half of its pieces are
 * in a different place than in each of them. A layout with no others to compare with is different.
 */
export const isDifferentEnough = (poses: readonly Pose[], others: readonly (readonly Pose[])[]): boolean =>
  piecesInOwnPlaces(poses, others).length >= piecesNeededInOwnPlaces(poses.length);
