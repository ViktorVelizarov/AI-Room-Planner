import { footprintBounds, outsideRoom, overlap, type Footprint } from "./footprint";
import type { FurnitureItem } from "./furniture";
import { describePiece, footprintOf, isRug, normaliseRotation, type Pose } from "./layout";
import type { RoomSize } from "./room";

/**
 * Checking a layout, and fixing what is wrong with it in code. This is the way chosen in the
 * overlap research (docs/overlap-avoidance.md): the footprints of the pieces are checked, and what
 * the check finds is fixed first by pushing the pieces that overlap apart (`repair`) and then, for
 * any that are still wrong, by looking for the nearest free place (`placeNearest`). Only the last
 * resort of `fixLayout` turns a piece, and no piece is added or taken away.
 */

/** What a layout needs to know about a piece of the list: what it is and how big. */
export type Piece = Pick<FurnitureItem, "label" | "width_cm" | "depth_cm">;
/** The floor of the room. */
export type Floor = Pick<RoomSize, "width_m" | "length_m">;

/** The gaps that fixing aims for, in metres, so that pieces are not just touching. The prompt asks the AI for more; this is what the code insists on. */
export const FIX_PIECE_GAP_M = 0.03;
export const FIX_WALL_GAP_M = 0.02;

/** A move of less than this, in metres, is not worth telling the user about. */
const MOVED_M = 0.005;

export type Problems = {
  /** Pairs of pieces, by their places in the list, that are in each other, or closer than the gap. */
  overlaps: { a: number; b: number }[];
  /** Pieces that stick out through a wall, and by how much. */
  outside: { piece: number; metres: number }[];
};

/**
 * What is wrong with a layout: pieces that share floor, and pieces that go through a wall. A rug is
 * not checked against other pieces, but is kept in the room. With a `gap` or a `wallGap`, pieces
 * that are closer than that to each other or to a wall are counted too.
 */
export function findProblems(pieces: readonly Piece[], poses: readonly Pose[], room: Floor, { gap = 0, wallGap = 0 } = {}): Problems {
  const feet = pieces.map((piece, index) => footprintOf(piece, poses[index]));
  const overlaps: Problems["overlaps"] = [];
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      if (isRug(pieces[a]) || isRug(pieces[b])) continue;
      if (overlap(feet[a], feet[b], gap)) overlaps.push({ a, b });
    }
  }
  const outside = feet.flatMap((foot, piece) => {
    const metres = outsideRoom(foot, room, wallGap);
    return metres > 0 ? [{ piece, metres }] : [];
  });
  return { overlaps, outside };
}

export const isValid = ({ overlaps, outside }: Problems) => overlaps.length === 0 && outside.length === 0;

/** The problems as sentences, for a log or a message: "Sofa (item 1) overlaps Coffee table (item 3)." */
export function describeProblems(pieces: readonly Piece[], { overlaps, outside }: Problems): string[] {
  const name = (index: number) => describePiece(pieces[index].label, index);
  return [
    ...overlaps.map(({ a, b }) => `${name(a)} overlaps ${name(b)}.`),
    ...outside.map(({ piece, metres }) => `${name(piece)} sticks out of the room by ${Math.round(metres * 100)} cm.`),
  ];
}

/** How far a footprint has to move to be inside the walls: a piece that is too big for the room is centred. */
function shiftInside(foot: Footprint, room: Floor, wallGap: number): { x: number; z: number } {
  const { minX, maxX, minZ, maxZ } = footprintBounds(foot);
  const along = (min: number, max: number, half: number) =>
    max - min > 2 * half ? -(min + max) / 2 : min < -half ? -half - min : max > half ? half - max : 0;
  return { x: along(minX, maxX, room.width_m / 2 - wallGap), z: along(minZ, maxZ, room.length_m / 2 - wallGap) };
}

export type RepairOptions = { gap?: number; wallGap?: number; rounds?: number };

/**
 * Fixes a layout by pushing. Each round pulls every piece back inside the walls and pushes apart
 * every two pieces that overlap, along the shortest way, the lighter piece (by footprint area)
 * moving the further. It stops when a round changes nothing, or after `rounds`. Pieces are not
 * turned, and a rug is only kept in the room. It keeps the arrangement of the AI best, but it can
 * get stuck: it only pushes the shortest way, so pieces that have to be spread another way are not.
 */
export function repair(pieces: readonly Piece[], poses: readonly Pose[], room: Floor, { gap = FIX_PIECE_GAP_M, wallGap = FIX_WALL_GAP_M, rounds = 300 }: RepairOptions = {}) {
  const moved = poses.map((pose) => ({ ...pose }));
  const weight = pieces.map((piece) => piece.width_cm * piece.depth_cm);
  for (let round = 0; round < rounds; round++) {
    let changed = false;
    moved.forEach((pose, index) => {
      const shift = shiftInside(footprintOf(pieces[index], pose), room, wallGap);
      if (shift.x !== 0 || shift.z !== 0) {
        pose.x_m += shift.x;
        pose.z_m += shift.z;
        changed = true;
      }
    });
    for (let a = 0; a < pieces.length; a++) {
      for (let b = a + 1; b < pieces.length; b++) {
        if (isRug(pieces[a]) || isRug(pieces[b])) continue;
        const found = overlap(footprintOf(pieces[a], moved[a]), footprintOf(pieces[b], moved[b]), gap);
        if (!found) continue;
        const total = weight[a] + weight[b];
        moved[a].x_m -= found.x * found.depth * (weight[b] / total);
        moved[a].z_m -= found.z * found.depth * (weight[b] / total);
        moved[b].x_m += found.x * found.depth * (weight[a] / total);
        moved[b].z_m += found.z * found.depth * (weight[a] / total);
        changed = true;
      }
    }
    if (!changed) return { poses: moved, rounds: round };
  }
  return { poses: moved, rounds };
}

export type SearchOptions = { gap?: number; wallGap?: number; step?: number };

/** How far apart the places that are tried are, in metres: 5 cm in a room of ordinary size, wider in a very big one, so that the work stays about the same. */
const searchStep = (room: Floor) => Math.max(0.05, Math.sqrt(room.width_m * room.length_m) / 100);

/**
 * Fixes a layout by looking for free places. The biggest pieces are looked at first. A piece that is
 * fine where it was put, inside the walls and clear of the pieces already placed, stays there; any
 * other goes to the nearest place that is fine, looking at places `step` apart around where it was
 * put. Pieces are not turned, and a rug is only kept in the room. A piece that finds no place stays
 * where it was, and is listed in `unplaced`.
 */
export function placeNearest(pieces: readonly Piece[], poses: readonly Pose[], room: Floor, { gap = FIX_PIECE_GAP_M, wallGap = FIX_WALL_GAP_M, step = searchStep(room) }: SearchOptions = {}) {
  const placed = poses.map((pose) => ({ ...pose }));
  const unplaced: number[] = [];
  const standing: number[] = [];
  const farthest = Math.ceil(Math.hypot(room.width_m, room.length_m) / step);

  // The circle around each footprint, so that pieces that are far apart are not looked at closely. With the gap a corner reaches 0.7 gap further, in each of the two.
  const reach = pieces.map((piece) => Math.hypot(piece.width_cm, piece.depth_cm) / 200);
  const fine = (index: number, pose: Pose) => {
    // The middle of a piece that is in the room is in the room, which rules out most places at once.
    if (Math.abs(pose.x_m) > room.width_m / 2 || Math.abs(pose.z_m) > room.length_m / 2) return false;
    const foot = footprintOf(pieces[index], pose);
    if (outsideRoom(foot, room, wallGap) > 0) return false;
    return standing.every((other) => {
      const near = reach[index] + reach[other] + Math.SQRT2 * gap;
      if ((pose.x_m - placed[other].x_m) ** 2 + (pose.z_m - placed[other].z_m) ** 2 >= near * near) return true;
      return !overlap(foot, footprintOf(pieces[other], placed[other]), gap);
    });
  };

  /** The nearest place that is fine, looking ring by ring (whole steps) round where the piece was put. */
  const nearest = (index: number): { dx: number; dz: number } | null => {
    const wish = placed[index];
    // Set in `look`, which TypeScript does not follow, so it is told what `best` can be.
    let best = null as { dx: number; dz: number; distance: number } | null;
    const look = (dx: number, dz: number) => {
      const distance = dx * dx + dz * dz;
      if (best && distance >= best.distance) return;
      if (fine(index, { ...wish, x_m: wish.x_m + dx * step, z_m: wish.z_m + dz * step })) best = { dx, dz, distance };
    };
    for (let ring = 0; ring <= farthest; ring++) {
      // Every place of this ring is at least `ring` steps away, so once one that is nearer than that is found, none further out can beat it.
      if (best && ring * ring > best.distance) break;
      if (ring === 0) look(0, 0);
      for (let along = -ring; ring > 0 && along <= ring; along++) {
        look(along, -ring);
        look(along, ring);
        if (along > -ring && along < ring) {
          look(-ring, along);
          look(ring, along);
        }
      }
    }
    return best;
  };

  const order = pieces.map((_, index) => index).sort((a, b) => pieces[b].width_cm * pieces[b].depth_cm - pieces[a].width_cm * pieces[a].depth_cm);
  for (const index of order) {
    if (isRug(pieces[index])) {
      const shift = shiftInside(footprintOf(pieces[index], placed[index]), room, wallGap);
      placed[index].x_m += shift.x;
      placed[index].z_m += shift.z;
      continue;
    }
    const found = nearest(index);
    if (!found) {
      unplaced.push(index);
      continue;
    }
    placed[index] = { ...placed[index], x_m: placed[index].x_m + found.dx * step, z_m: placed[index].z_m + found.dz * step };
    standing.push(index);
  }
  return { poses: placed, unplaced };
}

/** A turn of less than this, in degrees, is not worth telling the user about. */
const TURNED_DEGREES = 1;

/** The pieces, by their places in the list, that are not as they were: moved more than half a centimetre, or turned more than a degree. */
export function adjustedPieces(before: readonly Pose[], after: readonly Pose[]): number[] {
  return before.flatMap((pose, index) => {
    const turn = Math.abs(((after[index].rotation_deg - pose.rotation_deg + 540) % 360) - 180);
    const moved = Math.hypot(after[index].x_m - pose.x_m, after[index].z_m - pose.z_m) > MOVED_M;
    return moved || turn > TURNED_DEGREES ? [index] : [];
  });
}

export type FixResult = {
  /** Whether the layout is fine now: no pieces in each other and none through a wall. */
  ok: boolean;
  /** The layout as far as it could be fixed. */
  poses: Pose[];
  /** The pieces that were moved or turned, by their places in the list. */
  adjusted: number[];
};

/**
 * The gaps that are aimed for, from the most to nothing: a room that is too full for 3 cm between
 * pieces may still hold them with pieces that touch, and a layout is fine when nothing overlaps.
 */
const GAPS = [
  { gap: FIX_PIECE_GAP_M, wallGap: FIX_WALL_GAP_M },
  { gap: 0.01, wallGap: 0 },
  { gap: 0, wallGap: 0 },
];

const countProblems = (problems: Problems) => problems.overlaps.length + problems.outside.length;

/** The layout with every turn made the nearest quarter turn: 0, 90, 180 or 270. */
const squared = (poses: readonly Pose[]): Pose[] =>
  poses.map((pose) => ({ ...pose, rotation_deg: normaliseRotation(Math.round(pose.rotation_deg / 90) * 90) }));

/**
 * Makes a layout fine, if it can be made so. A layout that is fine already is left exactly as it is.
 * Otherwise it is repaired, and what repair leaves wrong goes to the search for free places, aiming
 * for gaps of 3 cm to pieces and 2 cm to walls, and for smaller gaps, down to none, if the room is
 * too full for those. A piece that is at an angle may not fit a tight room, so if all that does
 * not make the layout fine, it is tried again with every turn made the nearest quarter turn, which
 * is the one thing here that turns a piece. If nothing makes it fine, the result is the attempt
 * with the fewest problems.
 */
export function fixLayout(pieces: readonly Piece[], poses: readonly Pose[], room: Floor): FixResult {
  const given = poses.map((pose) => ({ ...pose }));
  if (isValid(findProblems(pieces, given, room))) return { ok: true, poses: given, adjusted: [] };

  let best: { result: Pose[]; problems: number } | null = null;
  const starts = [given];
  if (squared(given).some((pose, index) => pose.rotation_deg !== given[index].rotation_deg)) starts.push(squared(given));
  for (const start of starts) {
    for (const gaps of GAPS) {
      const repaired = repair(pieces, start, room, gaps).poses;
      const result = isValid(findProblems(pieces, repaired, room)) ? repaired : placeNearest(pieces, repaired, room, gaps).poses;
      const problems = countProblems(findProblems(pieces, result, room));
      if (problems === 0) return { ok: true, poses: result, adjusted: adjustedPieces(given, result) };
      if (!best || problems < best.problems) best = { result, problems };
    }
  }
  return { ok: false, poses: best!.result, adjusted: adjustedPieces(given, best!.result) };
}
