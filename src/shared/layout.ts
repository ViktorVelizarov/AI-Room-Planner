import type { Footprint } from "./footprint";
import { FURNITURE_NAMES, type FurnitureItem, type FurnitureLabel } from "./furniture";
import type { RoomDescription, RoomDescriptionResult } from "./room-description";
import { parseRoomDescription } from "./room-description";

/**
 * Where a piece of furniture is put in the room. It stands on the floor, so three numbers say it all:
 * `x_m` and `z_m` are the middle of its footprint in metres from the middle of the floor (x across the
 * room, towards the right wall; z along it, towards the front wall, which is the side the camera
 * starts on), and `rotation_deg` is the way its front faces: 0 towards the front wall (+z), and a
 * positive angle turns the front towards +x, as `rotation.y` does in Three.js. The size of the piece
 * is not in it: that is in the furniture list, and a layout lists its poses in the same order.
 */
export type Pose = { x_m: number; z_m: number; rotation_deg: number };

/** The most pieces that a layout is made for. More than this is far beyond a room, and the work grows with the square of it. */
export const MAX_LAYOUT_PIECES = 40;

/**
 * How much of the floor the pieces may cover before there is no use asking for a layout: in the
 * overlap research (docs/overlap-avoidance.md) nothing found a layout at 70% and over.
 */
export const MAX_FLOOR_COVERAGE = 0.7;
/** From here a layout may well not be possible, which is worth telling the user before they ask. */
export const CROWDED_FLOOR_COVERAGE = 0.6;

/** Areas are sums of products, so a floor that is covered exactly as much as a limit says may come out a hair either side of it. */
const COVERAGE_TOLERANCE = 1e-9;

/** A rug lies on the floor, and other pieces stand on it, so it is the one piece that may overlap another. */
export const isRug = (item: Pick<FurnitureItem, "label">) => item.label === "rug";

/** The footprint of a piece of the list, put where the pose says. */
export const footprintOf = (item: Pick<FurnitureItem, "width_cm" | "depth_cm">, pose: Pose): Footprint => ({
  ...pose,
  width_m: item.width_cm / 100,
  depth_m: item.depth_cm / 100,
});

/** A turn in degrees as the same turn from 0 up to, not including, 360. */
export const normaliseRotation = (degrees: number) => ((degrees % 360) + 360) % 360;

/** A piece for the user, by its type and its place in the list, as the rest of the app says it: "Sofa (item 1)". */
export const describePiece = (label: FurnitureLabel, index: number) => `${FURNITURE_NAMES[label]} (item ${index + 1})`;

/** The part of the floor that the pieces cover, from 0 to more than 1 when they cannot all fit. A rug lies under other pieces, so it does not count. */
export function floorCoverage({ room, furniture }: Pick<RoomDescription, "room" | "furniture">): number {
  const covered = furniture.filter((item) => !isRug(item)).reduce((sum, item) => sum + (item.width_cm / 100) * (item.depth_cm / 100), 0);
  return covered / (room.width_m * room.length_m);
}

/** The places in the list of the pieces that do not fit in the room whichever way they are turned. */
export function piecesBiggerThanRoom({ room, furniture }: Pick<RoomDescription, "room" | "furniture">): number[] {
  const fits = (across: number, along: number) => across <= room.width_m + 1e-9 && along <= room.length_m + 1e-9;
  return furniture.flatMap((item, index) => {
    const [width, depth] = [item.width_cm / 100, item.depth_cm / 100];
    return fits(width, depth) || fits(depth, width) ? [] : [index];
  });
}

/**
 * Why there is no use asking for a layout for these pieces in this room, as a sentence for the user,
 * or `null` if there is: a piece that is bigger than the room, or pieces that cover so much of the
 * floor that nothing found a layout without overlaps (the overlap research, docs/overlap-avoidance.md).
 */
export function whyNoLayoutIsPossible(description: Pick<RoomDescription, "room" | "furniture">): string | null {
  const tooBig = piecesBiggerThanRoom(description);
  if (tooBig.length > 0) {
    const names = tooBig.map((index) => describePiece(description.furniture[index].label, index)).join(", ");
    return `${names} ${tooBig.length === 1 ? "is" : "are"} bigger than the room, so no layout is possible. Check the size of the room and the size of the piece.`;
  }
  const coverage = floorCoverage(description);
  if (coverage > MAX_FLOOR_COVERAGE + COVERAGE_TOLERANCE) {
    return `Your furniture would cover ${Math.round(coverage * 100)}% of the floor, which leaves no room for a layout without overlaps. Check the size of the room, or take some furniture out of the list.`;
  }
  return null;
}

/** A warning, as a sentence for the user, when the pieces cover so much of the floor that a layout may well not be possible; `null` when the room is not that full. */
export function crowdedWarning(description: Pick<RoomDescription, "room" | "furniture">): string | null {
  const coverage = floorCoverage(description);
  if (coverage < CROWDED_FLOOR_COVERAGE - COVERAGE_TOLERANCE || coverage > MAX_FLOOR_COVERAGE + COVERAGE_TOLERANCE) return null;
  return `Your furniture covers about ${Math.round(coverage * 100)}% of the floor, so a layout without overlaps may not be possible.`;
}

/**
 * What a layout is made for: the floor of the room, and the type and footprint of each piece in the order of
 * the list. Two descriptions with the same key can share a layout, whatever the colours, materials and heights
 * are, which a layout does not depend on, so a layout that was paid for is kept when only those change.
 */
export const layoutKey = ({ room, furniture }: Pick<RoomDescription, "room" | "furniture">): string =>
  JSON.stringify([room.width_m, room.length_m, furniture.map(({ label, width_cm, depth_cm }) => [label, width_cm, depth_cm])]);

/** What goes into a layout request: a room description, with not too many pieces. Never throws. */
export function checkLayoutRequest(input: unknown): RoomDescriptionResult {
  const checked = parseRoomDescription(input);
  if (!checked.ok) return checked;
  const count = checked.description.furniture.length;
  if (count > MAX_LAYOUT_PIECES) {
    return { ok: false, problems: [`A layout can be made for at most ${MAX_LAYOUT_PIECES} pieces of furniture, and the list has ${count}.`] };
  }
  return checked;
}

const WALLS = ["the front wall", "the right wall", "the back wall", "the left wall"];

/** Which way the front of a piece faces, in words for the user: "the right wall", or "between the front wall and the right wall" for an angle. */
export function describeFacing(rotation_deg: number): string {
  const turn = normaliseRotation(rotation_deg);
  const quarter = Math.round(turn / 90);
  if (Math.abs(turn - quarter * 90) <= 5) return WALLS[quarter % 4];
  const before = Math.floor(turn / 90);
  return `between ${WALLS[before]} and ${WALLS[(before + 1) % 4]}`;
}
