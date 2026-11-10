// The ways of stopping furniture from overlapping that were tried in the overlap research (US-18),
// as small functions on a layout: the pieces, and where each one is put. See docs/overlap-avoidance.md.
import { footprintBounds, outsideRoom, overlap, overlapArea, type Footprint } from "../src/shared/footprint";

export type Room = { width_m: number; length_m: number };
/** What a layout needs to know about a piece: what it is and how big, in cm as in the furniture list. */
export type Piece = { label: string; width_cm: number; depth_cm: number };
/** Where a piece is put: the middle of its footprint, in metres from the middle of the floor, and its turn in degrees. */
export type Pose = { x_m: number; z_m: number; rotation_deg: number };

/** A rug lies on the floor and other pieces stand on it, so it is the one kind of piece that may overlap another. */
export const isRug = (piece: Piece) => piece.label === "rug";

export const footprintOf = (piece: Piece, pose: Pose): Footprint => ({ ...pose, width_m: piece.width_cm / 100, depth_m: piece.depth_cm / 100 });

export type Problems = {
  /** Pairs of pieces (by place in the list) that are in each other, or closer than the gap, and how much they share. */
  overlaps: { a: number; b: number; area_m2: number }[];
  /** Pieces that stick out through a wall, and by how much. */
  outside: { piece: number; metres: number }[];
};

/** What is wrong with a layout, by the first approach: the check of the footprints, "bounding-box check". */
export function findProblems(pieces: Piece[], poses: Pose[], room: Room, { gap = 0, wallGap = 0 } = {}): Problems {
  const feet = pieces.map((piece, index) => footprintOf(piece, poses[index]));
  const overlaps: Problems["overlaps"] = [];
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      if (isRug(pieces[a]) || isRug(pieces[b])) continue;
      if (overlap(feet[a], feet[b], gap)) overlaps.push({ a, b, area_m2: overlapArea(feet[a], feet[b]) });
    }
  }
  const outside = feet.flatMap((foot, piece) => {
    const metres = outsideRoom(foot, room, wallGap);
    return metres > 0 ? [{ piece, metres }] : [];
  });
  return { overlaps, outside };
}

export const isValid = ({ overlaps, outside }: Problems) => overlaps.length === 0 && outside.length === 0;

/** How far a footprint has to move to be inside the walls (a piece that is too big for the room is centred). */
function shiftInside(foot: Footprint, room: Room, wallGap: number): { x: number; z: number } {
  const { minX, maxX, minZ, maxZ } = footprintBounds(foot);
  const along = (min: number, max: number, half: number) =>
    max - min > 2 * half ? -(min + max) / 2 : min < -half ? -half - min : max > half ? half - max : 0;
  return { x: along(minX, maxX, room.width_m / 2 - wallGap), z: along(minZ, maxZ, room.length_m / 2 - wallGap) };
}

export type RepairOptions = { gap?: number; wallGap?: number; rounds?: number };

/**
 * The second approach: check, and then fix in code. Each round pulls every piece back inside the
 * walls and pushes apart every two pieces that overlap, along the shortest way, the lighter piece
 * (by footprint area) moving the further. It stops when a round changes nothing, or after `rounds`.
 * Nothing is turned, and a rug is only kept in the room.
 */
export function repair(pieces: Piece[], poses: Pose[], room: Room, { gap = 0.03, wallGap = 0.02, rounds = 300 }: RepairOptions = {}) {
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

/** How far each piece is from where it was, in cm, and how many were turned. */
export function movement(before: Pose[], after: Pose[]) {
  const cm = before.map((pose, index) => Math.hypot(after[index].x_m - pose.x_m, after[index].z_m - pose.z_m) * 100);
  const turned = before.filter((pose, index) => Math.abs(((after[index].rotation_deg - pose.rotation_deg + 540) % 360) - 180) > 1e-6).length;
  return { mean_cm: cm.reduce((sum, value) => sum + value, 0) / Math.max(1, cm.length), max_cm: Math.max(0, ...cm), moved: cm.filter((value) => value > 0.5).length, turned };
}

export type SearchOptions = { gap?: number; wallGap?: number; step?: number };

const movesKept = new Map<string, [number, number][]>();

/** Every way of moving a piece by whole steps, up to `reachX` of them across and `reachZ` along, the shortest first. */
function movesAround(reachX: number, reachZ: number): [number, number][] {
  const key = `${reachX}x${reachZ}`;
  let moves = movesKept.get(key);
  if (!moves) {
    moves = [];
    for (let dz = -reachZ; dz <= reachZ; dz++) for (let dx = -reachX; dx <= reachX; dx++) moves.push([dx, dz]);
    moves.sort((p, q) => p[0] ** 2 + p[1] ** 2 - (q[0] ** 2 + q[1] ** 2));
    movesKept.set(key, moves);
  }
  return moves;
}

/**
 * A fourth approach, which the research found along the way: check, and then look for a free place
 * in the exact geometry, with no grid to round to. The biggest pieces are looked at first. A piece
 * that is fine where the AI put it, inside the walls and clear of the pieces already placed, stays
 * there; any other goes to the nearest place that is fine, looking at places `step` apart around
 * where it was put. It is not turned, and a rug is only kept in the room. A piece that finds no
 * place stays where it was, and is listed in `unplaced`.
 */
export function placeNearest(pieces: Piece[], poses: Pose[], room: Room, { gap = 0.03, wallGap = 0.02, step = 0.05 }: SearchOptions = {}) {
  const placed = poses.map((pose) => ({ ...pose }));
  const unplaced: number[] = [];
  const standing: number[] = [];
  const moves = movesAround(Math.ceil(room.width_m / step), Math.ceil(room.length_m / step));

  // The circle around each footprint, so that pieces that are far apart are not looked at closely. With the gap a corner reaches 0.7 gap further, in each of the two.
  const reach = pieces.map((piece) => Math.hypot(piece.width_cm, piece.depth_cm) / 200);
  const fine = (index: number, pose: Pose) => {
    const foot = footprintOf(pieces[index], pose);
    if (outsideRoom(foot, room, wallGap) > 0) return false;
    return standing.every((other) => {
      const near = reach[index] + reach[other] + Math.SQRT2 * gap;
      if ((pose.x_m - placed[other].x_m) ** 2 + (pose.z_m - placed[other].z_m) ** 2 >= near * near) return true;
      return !overlap(foot, footprintOf(pieces[other], placed[other]), gap);
    });
  };

  const order = pieces.map((_, index) => index).sort((a, b) => pieces[b].width_cm * pieces[b].depth_cm - pieces[a].width_cm * pieces[a].depth_cm);
  for (const index of order) {
    if (isRug(pieces[index])) {
      const shift = shiftInside(footprintOf(pieces[index], placed[index]), room, wallGap);
      placed[index].x_m += shift.x;
      placed[index].z_m += shift.z;
      continue;
    }
    const wish = placed[index];
    const found = moves.find(([dx, dz]) => {
      const [x_m, z_m] = [wish.x_m + dx * step, wish.z_m + dz * step];
      // The middle of a piece that is in the room is in the room, which rules out most of the moves at once.
      return Math.abs(x_m) <= room.width_m / 2 && Math.abs(z_m) <= room.length_m / 2 && fine(index, { ...wish, x_m, z_m });
    });
    if (!found) {
      unplaced.push(index);
      continue;
    }
    placed[index] = { ...wish, x_m: wish.x_m + found[0] * step, z_m: wish.z_m + found[1] * step };
    standing.push(index);
  }
  return { poses: placed, unplaced };
}

export type GridOptions = {
  /** Whether two pieces may not share a cell: the grid then forbids what the AI asked for. Without it the grid only rounds. */
  enforce?: boolean;
};

/**
 * The third approach: the pieces are put on a grid of square cells. A piece takes the whole cells
 * that its footprint reaches into, turned to the nearest quarter, and its middle is the middle of
 * that block. The AI's wish is taken as the nearest free place for the block; the biggest pieces
 * are placed first. Blocks cannot overlap, and so the real footprints, which are inside them, cannot
 * either. A rug takes no cells. With `enforce: false` the blocks are only rounded to the grid.
 */
export function placeOnGrid(pieces: Piece[], poses: Pose[], room: Room, cell: number, { enforce = true }: GridOptions = {}) {
  const columns = Math.floor(room.width_m / cell + 1e-9);
  const rows = Math.floor(room.length_m / cell + 1e-9);
  const left = -(columns * cell) / 2;
  const top = -(rows * cell) / 2;
  const taken = Array.from({ length: rows }, () => new Array<boolean>(columns).fill(false));
  const placed = poses.map((pose) => ({ ...pose }));
  const unplaced: number[] = [];
  let blocks = 0;
  let real = 0;

  const order = pieces.map((_, index) => index).sort((a, b) => pieces[b].width_cm * pieces[b].depth_cm - pieces[a].width_cm * pieces[a].depth_cm);
  for (const index of order) {
    const piece = pieces[index];
    const rotation = ((Math.round(poses[index].rotation_deg / 90) * 90) % 360 + 360) % 360;
    const turned = rotation === 90 || rotation === 270;
    const across = (turned ? piece.depth_cm : piece.width_cm) / 100;
    const along = (turned ? piece.width_cm : piece.depth_cm) / 100;
    const [wide, deep] = [Math.ceil(across / cell - 1e-9), Math.ceil(along / cell - 1e-9)];
    placed[index].rotation_deg = rotation;
    // The block's top left cell that comes nearest to what was asked for.
    const wishColumn = Math.round((poses[index].x_m - (wide * cell) / 2 - left) / cell);
    const wishRow = Math.round((poses[index].z_m - (deep * cell) / 2 - top) / cell);
    let best: { column: number; row: number } | null = null;
    let bestDistance = Infinity;
    for (let row = 0; row <= rows - deep; row++) {
      for (let column = 0; column <= columns - wide; column++) {
        const free = isRug(piece) || !enforce || taken.slice(row, row + deep).every((line) => line.slice(column, column + wide).every((cellTaken) => !cellTaken));
        const distance = (column - wishColumn) ** 2 + (row - wishRow) ** 2;
        if (free && distance < bestDistance) [best, bestDistance] = [{ column, row }, distance];
      }
    }
    if (!best) {
      unplaced.push(index);
      continue;
    }
    if (!isRug(piece)) {
      for (let row = best.row; row < best.row + deep; row++) for (let column = best.column; column < best.column + wide; column++) taken[row][column] = true;
      blocks += wide * deep * cell * cell;
      real += (piece.width_cm * piece.depth_cm) / 10000;
    }
    placed[index].x_m = left + (best.column + wide / 2) * cell;
    placed[index].z_m = top + (best.row + deep / 2) * cell;
  }
  return { poses: placed, unplaced, wasted: real > 0 ? (blocks - real) / real : 0 };
}

/** A small seeded random generator, so that a simulation gives the same numbers each time. */
export function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gaussian = (next: () => number) => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());

/**
 * What an AI answer might be like if it knew where everything should go but was not exact: every
 * piece is off by a normal error of `sigma_m` in x and in z, and now and then (`turnRate`) a piece is
 * turned a quarter the wrong way, which changes its footprint.
 */
export function perturb(poses: Pose[], sigma_m: number, turnRate: number, next: () => number): Pose[] {
  return poses.map((pose) => ({
    x_m: pose.x_m + gaussian(next) * sigma_m,
    z_m: pose.z_m + gaussian(next) * sigma_m,
    rotation_deg: next() < turnRate ? pose.rotation_deg + (next() < 0.5 ? 90 : -90) : pose.rotation_deg,
  }));
}
