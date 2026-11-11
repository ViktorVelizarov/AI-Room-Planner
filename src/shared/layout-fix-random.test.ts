import { Matrix4, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import samples from "../../docs/overlap-research/samples.json";
import { CROWDED_FINE, crowdedRoom } from "../test/crowded-room";
import { overlapArea } from "./footprint";
import { footprintOf, isRug, type Pose } from "./layout";
import { FIX_ATTEMPTS, findProblems, fixLayout, isValid, type Floor, type Piece } from "./layout-fix";

// US-22 AC1 and AC2, on many layouts that are nearly right, the way an AI's answer may be: what `fixLayout` calls
// fine is looked at again by two checks that share no code with the check that `fixLayout` makes (the footprint
// check): the exact area that two pieces have in common, and the places of the pieces in a Three.js scene, which
// is how the 3D room stands them. A layout that is fine for the one and not for the others would show a mistake in a check.

/** A small seeded random generator, so that the random tests are the same every time. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many points along each side of a piece the grid has that is laid over it. */
const GRID = 10;
/** The most floor that two pieces may share for the exact check to call them apart: a hair, from the numbers that are not exact. */
const AREA_TOLERANCE = 1e-8;

/** A piece stood in a Three.js scene as the 3D room stands it: where its corners are, a grid of points over it, and whether a point is inside it. */
function stood(piece: Piece, pose: Pose) {
  const object = new Object3D();
  object.position.set(pose.x_m, 0, pose.z_m);
  object.rotation.y = (pose.rotation_deg * Math.PI) / 180;
  object.updateMatrixWorld(true);
  const [width, depth] = [piece.width_cm / 100, piece.depth_cm / 100];
  const toWorld = (u: number, v: number) => new Vector3(u * width, 0, v * depth).applyMatrix4(object.matrixWorld);
  const toPiece = new Matrix4().copy(object.matrixWorld).invert();
  return {
    corners: [toWorld(-0.5, -0.5), toWorld(0.5, -0.5), toWorld(0.5, 0.5), toWorld(-0.5, 0.5)],
    points: Array.from({ length: GRID * GRID }, (_, i) => toWorld(((i % GRID) + 0.5) / GRID - 0.5, (Math.floor(i / GRID) + 0.5) / GRID - 0.5)),
    /** Whether the point is inside the piece by more than a millimetre. */
    holds(point: Vector3) {
      const local = point.clone().applyMatrix4(toPiece);
      return Math.abs(local.x) < width / 2 - 1e-3 && Math.abs(local.z) < depth / 2 - 1e-3;
    },
  };
}

/** What is wrong with a layout by the check of Three.js: pairs of pieces with a point of the grid of one inside the other, and pieces with a corner outside the room. A rug may lie under others. */
function seenByThree(pieces: readonly Piece[], poses: readonly Pose[], room: Floor) {
  const scene = pieces.map((piece, index) => stood(piece, poses[index]));
  const overlapping: [number, number][] = [];
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      if (isRug(pieces[a]) || isRug(pieces[b])) continue;
      if (scene[a].points.some((point) => scene[b].holds(point)) || scene[b].points.some((point) => scene[a].holds(point))) overlapping.push([a, b]);
    }
  }
  const outside = scene.flatMap((each, index) =>
    each.corners.some((corner) => Math.abs(corner.x) > room.width_m / 2 + 1e-9 || Math.abs(corner.z) > room.length_m / 2 + 1e-9) ? [index] : [],
  );
  return { overlapping, outside };
}

/** The pairs of pieces that share more than a hair of floor, by the exact area, with the area. A rug may lie under others. */
function sharedFloor(pieces: readonly Piece[], poses: readonly Pose[]) {
  const shared: { pair: [number, number]; area: number }[] = [];
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      if (isRug(pieces[a]) || isRug(pieces[b])) continue;
      const area = overlapArea(footprintOf(pieces[a], poses[a]), footprintOf(pieces[b], poses[b]));
      if (area > AREA_TOLERANCE) shared.push({ pair: [a, b], area });
    }
  }
  return shared;
}

type Sample = { name: string; room: { width_m: number; length_m: number }; pieces: Piece[]; layouts: { reference: Pose[] } };
// `atLeastFine` is the part of the answers that is made fine at least, a little under what was seen (for any seed of 5: 100% in the living room and the bedroom, 94% to 96% in the studio, 89% to 92% in the crowded bedroom).
// `laterAttempts` is for the rooms that are full enough for the first attempt not to be enough for some answers.
const rooms: { name: string; floor: Floor; pieces: Piece[]; reference: Pose[]; atLeastFine: number; laterAttempts: boolean }[] = [
  ...(samples.samples as Sample[]).map(({ name, room, pieces, layouts }, index) => ({
    name,
    floor: room,
    pieces,
    reference: layouts.reference,
    // The living room and the bedroom have plenty of floor, the studio does not (58%).
    atLeastFine: index < 2 ? 1 : 0.9,
    laterAttempts: index === 2,
  })),
  { name: "Crowded bedroom, 3 x 2.6 m (63%)", floor: crowdedRoom.room, pieces: crowdedRoom.furniture, reference: CROWDED_FINE, atLeastFine: 0.85, laterAttempts: true },
];

/** An answer that is nearly the reference, as an AI's may be: every piece off by a random error of `sigma` metres, a tenth of the pieces a quarter the wrong way, a tenth at an angle, and one in twenty put anywhere at all. */
function nearlyRight(reference: readonly Pose[], floor: Floor, sigma: number, next: () => number): Pose[] {
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const millimetre = (value: number) => Math.round(value * 1000) / 1000;
  return reference.map((pose) => {
    const lost = next() < 0.05;
    const x = lost ? (next() - 0.5) * (floor.width_m + 2) : pose.x_m + normal() * sigma;
    const z = lost ? (next() - 0.5) * (floor.length_m + 2) : pose.z_m + normal() * sigma;
    const quarter = next() < 0.1 ? (next() < 0.5 ? 90 : -90) : 0;
    const angle = next() < 0.1 ? (next() < 0.5 ? 1 : -1) * (15 + Math.floor(next() * 4) * 10) : 0;
    return { x_m: millimetre(x), z_m: millimetre(z), rotation_deg: Math.round((pose.rotation_deg + quarter + angle) * 10) / 10 };
  });
}

describe("the checks that are used to look at the layouts again", () => {
  const { pieces, floor, reference } = rooms[0];

  it("have nothing to say about a layout that is fine, however it is turned", () => {
    expect(seenByThree(pieces, reference, floor)).toEqual({ overlapping: [], outside: [] });
    expect(sharedFloor(pieces, reference)).toEqual([]);
  });

  it("see what is wrong with answers that have mistakes in them, at least what the footprint check sees of any size that matters", () => {
    const next = random(1);
    let withProblems = 0;
    for (let run = 0; run < 200; run++) {
      const poses = nearlyRight(reference, floor, 0.3, next);
      const found = findProblems(pieces, poses, floor);
      const big = sharedFloor(pieces, poses).filter(({ area }) => area >= 0.1);
      const three = seenByThree(pieces, poses, floor);

      // Pieces that share a tenth of a square metre or more are always seen by the grid, and a piece that the footprint check says sticks out is seen sticking out.
      for (const { pair } of big) expect(three.overlapping, `${run}`).toContainEqual(pair);
      expect(three.outside, `${run}`).toEqual(found.outside.map(({ piece }) => piece));
      // Nothing is seen by the grid that is not there.
      for (const [a, b] of three.overlapping) expect(found.overlaps, `${run}`).toContainEqual({ a, b });
      if (!isValid(found)) withProblems++;
    }
    // Not a test of answers that are fine to begin with.
    expect(withProblems).toBeGreaterThan(150);
  });
});

describe.each(rooms)("fixLayout on answers that are nearly right: $name", ({ floor, pieces, reference, atLeastFine, laterAttempts }) => {
  const RUNS = 300;
  const SIGMAS = [0.05, 0.1, 0.2, 0.3, 0.5];

  it("never calls a layout fine that has pieces in each other or through a wall, and says that the attempts ran out for one that it gives up on", () => {
    const next = random(2026);
    const fineIn = [0, 0, 0, 0];
    let givenUp = 0;
    for (let run = 0; run < RUNS; run++) {
      const given = nearlyRight(reference, floor, SIGMAS[run % SIGMAS.length], next);

      const result = fixLayout(pieces, given, floor);

      expect(result.poses, `${run}`).toHaveLength(pieces.length);
      if (result.ok) {
        fineIn[result.attempts]++;
        expect(isValid(findProblems(pieces, result.poses, floor)), `${run}`).toBe(true);
        expect(sharedFloor(pieces, result.poses), `${run}`).toEqual([]);
        expect(seenByThree(pieces, result.poses, floor), `${run}`).toEqual({ overlapping: [], outside: [] });
      } else {
        givenUp++;
        expect(result.attempts, `${run}`).toBe(FIX_ATTEMPTS);
        expect(isValid(findProblems(pieces, result.poses, floor)), `${run}`).toBe(false);
      }
    }
    // Most of the answers needed fixing, so this is not a test of layouts that were fine to begin with, and the room is not so full that nothing is made fine.
    expect(RUNS - givenUp - fineIn[0]).toBeGreaterThan(RUNS / 2);
    expect((RUNS - givenUp) / RUNS).toBeGreaterThanOrEqual(atLeastFine);
    // In a room that is full enough, some answers are only made fine by the second or the third attempt.
    if (laterAttempts) expect(fineIn[2] + fineIn[3]).toBeGreaterThan(0);
  }, 120_000);
});

describe("fixLayout on pieces that cannot fit in the room", () => {
  it("never calls the layout fine, whatever it is given, and has used up its attempts", () => {
    // Twenty beds of 1.6 m x 2 m cover 64 m2, which a floor of 8 m x 6 m, 48 m2, cannot hold.
    const beds = Array.from({ length: 20 }, () => ({ label: "bed", width_cm: 160, depth_cm: 200 }) as Piece);
    const floor: Floor = { width_m: 8, length_m: 6 };
    const next = random(7);

    for (let run = 0; run < 3; run++) {
      const given: Pose[] = beds.map(() => ({ x_m: (next() - 0.5) * floor.width_m, z_m: (next() - 0.5) * floor.length_m, rotation_deg: Math.floor(next() * 4) * 90 }));

      const result = fixLayout(beds, given, floor);

      expect(result.ok, `${run}`).toBe(false);
      expect(result.attempts, `${run}`).toBe(FIX_ATTEMPTS);
    }
  }, 120_000);
});
