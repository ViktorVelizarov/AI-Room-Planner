import { describe, expect, it } from "vitest";
import { CROWDED_FINE, CROWDED_UNFIXABLE, crowdedRoom } from "../test/crowded-room";
import {
  FIX_ATTEMPTS,
  FIX_PIECE_GAP_M,
  FIX_WALL_GAP_M,
  describeProblems,
  findProblems,
  fixLayout,
  isValid,
  adjustedPieces,
  placeNearest,
  repair,
  type Floor,
  type Piece,
} from "./layout-fix";
import type { Pose } from "./layout";

const room: Floor = { width_m: 5, length_m: 4 };
const piece = (label: string, width_cm: number, depth_cm: number) => ({ label, width_cm, depth_cm }) as Piece;
const at = (x_m: number, z_m: number, rotation_deg = 0): Pose => ({ x_m, z_m, rotation_deg });

const sofa = piece("sofa", 200, 90);
const table = piece("coffee_table", 100, 60);
const rug = piece("rug", 160, 230);

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

/** A layout that is nearly right: every piece off by a random error, and some turned a quarter the wrong way. */
function nearlyRight(poses: Pose[], sigma: number, turnRate: number, next: () => number): Pose[] {
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  return poses.map((pose) => ({
    x_m: pose.x_m + normal() * sigma,
    z_m: pose.z_m + normal() * sigma,
    rotation_deg: next() < turnRate ? pose.rotation_deg + (next() < 0.5 ? 90 : -90) : pose.rotation_deg,
  }));
}

describe("findProblems: the check of the footprints", () => {
  it("finds nothing wrong with pieces that are apart and inside the room", () => {
    const problems = findProblems([sofa, table], [at(0, 1.4, 180), at(0, 0.3)], room);

    expect(problems).toEqual({ overlaps: [], outside: [] });
    expect(isValid(problems)).toBe(true);
  });

  it("finds a pair that is in each other, by place in the list", () => {
    const problems = findProblems([sofa, table, sofa], [at(0, 1.4, 180), at(0, 0.8), at(-2, -1)], room);

    expect(problems.overlaps).toEqual([{ a: 0, b: 1 }]);
    expect(isValid(problems)).toBe(false);
  });

  it("does not count pieces that only touch", () => {
    expect(findProblems([sofa, sofa], [at(0, 0), at(2, 0)], room).overlaps).toEqual([]);
  });

  it("lets a rug lie under other pieces, but not through a wall", () => {
    const under = findProblems([rug, sofa, table], [at(0, 0.5), at(0, 0.5), at(0, 0.5)], room);

    expect(under.overlaps).toEqual([{ a: 1, b: 2 }]);
    expect(findProblems([rug], [at(2, 0)], room).outside).toEqual([{ piece: 0, metres: expect.closeTo(0.3, 9) }]);
  });

  it("says how far a piece sticks out of the room, with the turn taken into account", () => {
    const problems = findProblems([sofa, sofa], [at(0, -2, 0), at(2, 0, 90)], room);

    // The first is 0.45 m deep, so its middle on the back wall has 0.45 m out. The second, turned, reaches 1 m each way in z, and 0.45 in x: inside.
    expect(problems.outside).toEqual([{ piece: 0, metres: expect.closeTo(0.45, 9) }]);
    expect(findProblems([sofa], [at(2, 0, 90)], room).outside).toEqual([]);
    expect(findProblems([sofa], [at(2.2, 0, 0)], room).outside[0].metres).toBeCloseTo(0.7, 9);
  });

  it("counts pieces closer than the gap, and walls that count as further in", () => {
    const poses = [at(0, 0), at(2.04, 0)];

    expect(findProblems([sofa, sofa], poses, room).overlaps).toEqual([]);
    expect(findProblems([sofa, sofa], poses, room, { gap: 0.1 }).overlaps).toHaveLength(1);
    expect(findProblems([sofa], [at(1.5, 0)], room).outside).toEqual([]);
    expect(findProblems([sofa], [at(1.5, 0)], room, { wallGap: 0.1 }).outside).toHaveLength(1);
  });
});

describe("describeProblems: the problems as sentences", () => {
  it("says which pieces overlap, and how far a piece sticks out of the room, by name and place in the list", () => {
    // The TV stand is 40 cm deep and its middle is on the back wall, so 20 cm of it is outside.
    const pieces = [sofa, table, piece("tv_stand", 140, 40)];
    const problems = findProblems(pieces, [at(0, 1.4, 180), at(0, 0.8), at(0, -2)], room);

    expect(describeProblems(pieces, problems)).toEqual(["Sofa (item 1) overlaps Coffee table (item 2).", "TV stand (item 3) sticks out of the room by 20 cm."]);
  });

  it("has nothing to say about a layout that is fine", () => {
    expect(describeProblems([sofa], findProblems([sofa], [at(0, 0)], room))).toEqual([]);
  });
});

describe("repair: fix by pushing", () => {
  const pieces = [sofa, table, piece("armchair", 80, 85), piece("tv_stand", 140, 45)];

  it("leaves a layout that is fine exactly as it is", () => {
    const fine = [at(0, 1.4, 180), at(0, 0.2), at(-1.8, 0.4, 90), at(0, -1.7)];

    const result = repair(pieces, fine, room);

    expect(result.poses).toEqual(fine);
    expect(result.rounds).toBe(0);
  });

  it("pushes pieces that overlap apart, the lighter one the further, and leaves a gap", () => {
    const overlapping = [at(0, 0), at(0, 0.5)];

    const result = repair([sofa, table], overlapping, room, { gap: 0.05 });

    expect(isValid(findProblems([sofa, table], result.poses, room, { gap: 0.05 - 1e-6 }))).toBe(true);
    // The sofa (18,000 cm2) is heavier than the table (6,000 cm2) so it moves a third as far.
    const sofaMoved = Math.hypot(result.poses[0].x_m, result.poses[0].z_m);
    const tableMoved = Math.hypot(result.poses[1].x_m, result.poses[1].z_m - 0.5);
    expect(tableMoved).toBeCloseTo(sofaMoved * 3, 6);
  });

  it("pushes pieces apart whichever way they overlap: the first one back and the second one on", () => {
    // Tables 1 m wide and 0.6 m deep, in the middle of the room, so that no wall is in the way.
    const side = repair([table, table], [at(0, 0), at(0.8, 0)], room, { gap: 0 });
    const above = repair([table, table], [at(0, 0), at(0, 0.5)], room, { gap: 0 });

    expect(side.poses[0].x_m).toBeLessThan(0);
    expect(side.poses[1].x_m).toBeGreaterThan(0.8);
    expect(above.poses[0].z_m).toBeLessThan(0);
    expect(above.poses[1].z_m).toBeGreaterThan(0.5);
    expect(isValid(findProblems([table, table], side.poses, room))).toBe(true);
    expect(isValid(findProblems([table, table], above.poses, room))).toBe(true);
  });

  it("shares a push along x as it does along z: the lighter piece moves the further, by the share of the weights", () => {
    // They are 0.2 m into each other along x, and with the gap of 3 cm there is 0.23 m to go: a quarter of it for the sofa (18,000 cm2) and three quarters for the table (6,000 cm2).
    const result = repair([sofa, table], [at(0, 0), at(1.3, 0)], room, { gap: 0.03, wallGap: 0.02 });

    expect(result.poses[0].x_m).toBeCloseTo(-0.0575, 9);
    expect(result.poses[1].x_m).toBeCloseTo(1.4725, 9);
    expect(result.poses.map((pose) => pose.z_m)).toEqual([0, 0]);
    expect(result.rounds).toBe(1);
  });

  it("counts a round in which a piece was only pulled back into the room", () => {
    // The right end of the sofa is 0.5 m through the wall: it is pulled back to 2 cm from it in the first round, and there is nothing to do in the second.
    const result = repair([sofa], [at(2, 0)], room);

    expect(result.poses[0].x_m).toBeCloseTo(1.48, 9);
    expect(result.rounds).toBe(1);
  });

  it("leaves 3 cm between pieces and 2 cm to the walls when it is not told otherwise", () => {
    const result = repair([sofa, table], [at(0, -1.9), at(0, -1.5)], room);

    expect(FIX_PIECE_GAP_M).toBe(0.03);
    expect(FIX_WALL_GAP_M).toBe(0.02);
    expect(isValid(findProblems([sofa, table], result.poses, room, { gap: 0.03 - 1e-6, wallGap: 0.02 - 1e-6 }))).toBe(true);
  });

  it("pulls a piece that sticks out of the room back in, and keeps a gap to the wall", () => {
    const result = repair([sofa, table], [at(0, -2.2), at(2.6, 0)], room, { wallGap: 0.05 });

    expect(isValid(findProblems([sofa, table], result.poses, room, { wallGap: 0.05 - 1e-6 }))).toBe(true);
  });

  it("does not turn anything, and does not move a rug for being under a piece", () => {
    const poses = [at(0, 0.5), at(0, 0.5, 90), at(0, 0.5, 30)];

    const result = repair([rug, sofa, table], poses, room);

    expect(result.poses[0]).toEqual(poses[0]);
    expect(result.poses.map((pose) => pose.rotation_deg)).toEqual([0, 90, 30]);
  });

  it("keeps a rug inside the room", () => {
    const result = repair([rug], [at(2.4, 0)], room, { wallGap: 0 });

    expect(isValid(findProblems([rug], result.poses, room))).toBe(true);
  });

  it("does not change what it was given", () => {
    const given = [at(0, 0), at(0.1, 0.1)];
    const copy = JSON.parse(JSON.stringify(given));

    repair([sofa, table], given, room);

    expect(given).toEqual(copy);
  });

  it("gives up after its rounds when the room cannot hold the pieces, without losing or breaking anything", () => {
    const tiny: Floor = { width_m: 2.2, length_m: 1.2 };
    const poses = [at(0, 0), at(0.1, 0.1), at(-0.1, 0)];

    const result = repair([sofa, sofa, table], poses, tiny, { rounds: 50 });

    expect(result.rounds).toBe(50);
    expect(result.poses).toHaveLength(3);
    for (const pose of result.poses) expect(Number.isFinite(pose.x_m) && Number.isFinite(pose.z_m)).toBe(true);
    expect(isValid(findProblems([sofa, sofa, table], result.poses, tiny))).toBe(false);
  });

  it("centres a piece that is bigger than the room, instead of pushing it back and forth", () => {
    const small: Floor = { width_m: 1.5, length_m: 3 };

    const result = repair([sofa], [at(0.4, 0.3)], small, { rounds: 20 });

    expect(result.poses[0].x_m).toBeCloseTo(0, 9);
  });

  it("makes every random layout of a roomy room that is off in its positions fine", () => {
    const next = random(21);
    const reference = [at(0, 1.4, 180), at(0, 0.3), at(-1.8, 0.4, 90), at(0, -1.7)];
    let changed = 0;
    for (let run = 0; run < 300; run++) {
      const poses = nearlyRight(reference, 0.3, 0, next);

      const result = repair(pieces, poses, room, { gap: 0.03, wallGap: 0.02 });

      expect(isValid(findProblems(pieces, result.poses, room, { gap: 0.03 - 1e-6, wallGap: 0.02 - 1e-6 })), `${run}`).toBe(true);
      if (!isValid(findProblems(pieces, poses, room))) changed++;
    }
    // Most of them were not fine to begin with, so this is not a test of a repair that has nothing to do.
    expect(changed).toBeGreaterThan(150);
  });

  it("has a known limit: pieces that were turned the wrong way, and now have to stand end to end along the room, are only pushed along that line", () => {
    // The sofa and the TV stand are turned a quarter, so they reach 2 m and 1.4 m along the 4 m room, and with the table
    // between them they would need 4 m and the gaps: no room. They would have to be spread sideways, which is not the way
    // the shortest push goes, so the repair is stuck.
    const wrong = [at(-0.18, 1.8, 90), at(0, 0.2), at(-1.93, 0.17, 90), at(0, -1.58, -90)];

    const result = repair(pieces, wrong, room, { gap: 0.03, wallGap: 0.02 });

    expect(isValid(findProblems(pieces, result.poses, room, { gap: 0.03 - 1e-6, wallGap: 0.02 - 1e-6 }))).toBe(false);
    expect(result.rounds).toBe(300);
  });
});

describe("placeNearest: fix by looking for a free place", () => {
  const pieces = [sofa, table, piece("armchair", 80, 85), piece("tv_stand", 140, 45)];
  const strict = { gap: 0.03 - 1e-6, wallGap: 0.02 - 1e-6 };

  it("leaves a layout that is fine exactly as it is", () => {
    const fine = [at(0, 1.4, 180), at(0, 0.2), at(-1.8, 0.4, 90), at(0, -1.7)];

    const result = placeNearest(pieces, fine, room);

    expect(result.poses).toEqual(fine);
    expect(result.unplaced).toEqual([]);
  });

  it("moves a piece that sticks out through a wall only as far as it takes to be inside with the gap, to the nearest step", () => {
    // The sofa's middle is on the back wall, so it needs to move 0.45 + 0.02 m, and the steps are 0.05 m.
    const result = placeNearest([sofa], [at(0.1, -2)], room, { step: 0.05 });

    expect(result.poses[0].x_m).toBeCloseTo(0.1, 9);
    expect(result.poses[0].z_m).toBeCloseTo(-1.5, 9);
  });

  it("keeps the biggest piece where it is and moves the smaller one out of the way, to the nearest free place", () => {
    const result = placeNearest([table, sofa], [at(0, 0.3), at(0, 0)], room);

    expect(result.poses[1]).toEqual(at(0, 0));
    expect(isValid(findProblems([table, sofa], result.poses, room, strict))).toBe(true);
    // The table was 0.3 m from the sofa's middle, and the sofa is 0.45 deep and the table 0.3: about 0.5 m to go, not across the room.
    expect(Math.hypot(result.poses[0].x_m, result.poses[0].z_m - 0.3)).toBeLessThan(0.6);
  });

  it("finds the nearest free place, not just a free one", () => {
    // A sofa in the middle, and a table that is asked for in the same place: the nearest free places are above and below the sofa, 0.47 m off.
    const result = placeNearest([table, sofa], [at(0, 0), at(0, 0)], room, { step: 0.01 });

    const moved = Math.hypot(result.poses[0].x_m, result.poses[0].z_m);
    // The sofa is 0.45 deep half, the table 0.3 deep half, and the gap 0.03.
    expect(moved).toBeCloseTo(0.45 + 0.3 + 0.03, 1);
  });

  it("does not turn anything, and only keeps a rug in the room", () => {
    const result = placeNearest([rug, sofa], [at(2.4, 0, 30), at(0, 0.5, 90)], room);

    expect(result.poses.map((pose) => pose.rotation_deg)).toEqual([30, 90]);
    expect(isValid(findProblems([rug], [result.poses[0]], room))).toBe(true);
    expect(result.poses[1]).toEqual(at(0, 0.5, 90));
  });

  it("keeps a rug in the room along z as well as along x, without changing what it was given", () => {
    const given = [at(0, 1.9)];

    const result = placeNearest([rug], given, room);

    // The rug is 2.3 m long, so with its middle at 1.9 it is 1.05 m through the front wall: 2 cm from the wall is z = 0.83.
    expect(result.poses[0].z_m).toBeCloseTo(0.83, 9);
    expect(result.poses[0].x_m).toBe(0);
    expect(given).toEqual([at(0, 1.9)]);
  });

  it("looks at places 5 cm apart in a room of ordinary size, and further apart in a very big one", () => {
    const deep = piece("coffee_table", 100, 70);

    // The table that is asked for in the sofa has to move 0.53 m to be clear of it with the gap: 11 steps of 5 cm. In a room of 20 m x 20 m a step is a hundredth of the room's size, 20 cm, and 3 of them are 0.6 m.
    const ordinary = placeNearest([deep, sofa], [at(0, 0.3), at(0, 0)], room);
    const big = placeNearest([deep, sofa], [at(0, 0.3), at(0, 0)], { width_m: 20, length_m: 20 });

    expect(ordinary.poses[0].z_m).toBeCloseTo(0.85, 9);
    expect(big.poses[0].z_m).toBeCloseTo(0.9, 9);
  });

  it("looks as far as the whole room for a place", () => {
    // Asked for 4.5 m beyond the right wall of a room 8 m wide, a square piece has to come all the way back: to 2 cm from the wall, to the nearest step.
    const result = placeNearest([piece("side_table", 100, 100)], [at(8, 0)], { width_m: 8, length_m: 6 }, { step: 0.05 });

    expect(result.unplaced).toEqual([]);
    expect(result.poses[0].x_m).toBeCloseTo(3.45, 9);
    expect(result.poses[0].z_m).toBeCloseTo(0, 9);
  });

  it.each([
    [-3, -3],
    [3, 3],
    [3, -3],
    [-3, 3],
  ])("finds the nearest place in a corner when it is asked for a place beyond two walls: (%s, %s)", (x, z) => {
    // The nearest place is straight across the corner, as far in each direction, which is the corner of a ring of places.
    const result = placeNearest([piece("side_table", 100, 100)], [at(x, z)], { width_m: 4, length_m: 4 }, { step: 0.05 });

    expect(result.poses[0].x_m).toBeCloseTo(Math.sign(x) * 1.45, 9);
    expect(result.poses[0].z_m).toBeCloseTo(Math.sign(z) * 1.45, 9);
  });

  it("goes by the area of the pieces and not by their width: the piece with more floor stays where it is", () => {
    // The TV stand is wider (2 m) but covers 1 m2; the bookshelf is 1 m wide and 3 m deep, 3 m2.
    const result = placeNearest([piece("tv_stand", 200, 50), piece("bookshelf", 100, 300)], [at(0, 0), at(0, 0)], { width_m: 6, length_m: 6 }, { step: 0.05 });

    // The stand goes to a side of the shelf: 0.5 m (half the shelf's width) + 1 m (half its own) + 3 cm from the middle of the shelf is 1.53 m, so 1.55 m at the nearest step. Which side is not important.
    expect(result.poses[1]).toEqual(at(0, 0));
    expect(Math.abs(result.poses[0].x_m)).toBeCloseTo(1.55, 9);
    expect(result.poses[0].z_m).toBeCloseTo(0, 9);
  });

  it("does not let a piece that found no place stand in the way of the others", () => {
    // The bed is bigger than the room, so it finds no place and stays where it was. The table that is on it is fine where it is, as far as the walls and the other pieces that were placed go.
    const result = placeNearest([piece("bed", 210, 210), piece("side_table", 40, 40)], [at(0, 0), at(0.1, 0)], { width_m: 2, length_m: 2 });

    expect(result.unplaced).toEqual([0]);
    expect(result.poses[1]).toEqual(at(0.1, 0));
  });

  it("leaves the gaps to the pieces and the walls that it is asked for", () => {
    const next = random(8);
    const reference = [at(0, 1.4, 180), at(0, 0.3), at(-1.8, 0.4, 90), at(0, -1.7)];
    for (let run = 0; run < 100; run++) {
      const result = placeNearest(pieces, nearlyRight(reference, 0.3, 0.1, next), room, { gap: 0.1, wallGap: 0.1 });

      expect(result.unplaced, `${run}`).toEqual([]);
      expect(isValid(findProblems(pieces, result.poses, room, { gap: 0.1 - 1e-6, wallGap: 0.1 - 1e-6 })), `${run}`).toBe(true);
    }
  });

  it("fixes what the repair could not: pieces turned the wrong way that have to be spread sideways", () => {
    const wrong = [at(-0.18, 1.8, 90), at(0, 0.2), at(-1.93, 0.17, 90), at(0, -1.58, -90)];

    const result = placeNearest(pieces, wrong, room);

    expect(result.unplaced).toEqual([]);
    expect(isValid(findProblems(pieces, result.poses, room, strict))).toBe(true);
  });

  it("says which pieces found no place, and leaves them where they were", () => {
    const tiny: Floor = { width_m: 2.2, length_m: 1.2 };
    const poses = [at(0, 0), at(0.1, 0.1), at(-0.1, 0)];

    const result = placeNearest([sofa, sofa, table], poses, tiny);

    expect(result.unplaced.length).toBeGreaterThan(0);
    for (const index of result.unplaced) expect(result.poses[index]).toEqual(poses[index]);
  });

  it("is the same every time, and does not change what it was given", () => {
    const given = [at(0, 0), at(0.1, 0.1), at(-0.1, 0)];
    const copy = JSON.parse(JSON.stringify(given));

    const once = placeNearest([sofa, sofa, table], given, room);
    const twice = placeNearest([sofa, sofa, table], given, room);

    expect(twice).toEqual(once);
    expect(given).toEqual(copy);
  });

  it("copes with a very big room and as many pieces as a layout is made for, all asked for in the same place, in a short time", () => {
    const big: Floor = { width_m: 20, length_m: 20 };
    const crowd = Array.from({ length: 40 }, () => sofa);

    const started = Date.now();
    const result = placeNearest(crowd, crowd.map(() => at(0, 0)), big);

    expect(result.unplaced).toEqual([]);
    expect(isValid(findProblems(crowd, result.poses, big))).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("copes with a room in which nothing fits, in a short time", () => {
    const small: Floor = { width_m: 3, length_m: 3 };
    const crowd = Array.from({ length: 40 }, () => piece("bed", 200, 200));

    const started = Date.now();
    const result = placeNearest(crowd, crowd.map(() => at(0, 0)), small);

    expect(result.unplaced.length).toBeGreaterThan(30);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  // The search goes ring by ring and stops early, so it is checked against a search that looks at every place in the room, in whole steps from where the piece was asked for:
  // some pieces that are fine where they are, and a smaller one that is asked for somewhere in the room, often in one of them.
  const floorOfOracle: Floor = { width_m: 4, length_m: 3 };
  const oracleStep = 0.1;
  const aimed = { gap: FIX_PIECE_GAP_M, wallGap: FIX_WALL_GAP_M };

  /** Asks placeNearest for the place of the last piece, and returns how many steps (squared) it is from where it was asked for, and how many the nearest of all the places is. */
  function nearestAndFound(sizes: number[][], fixed: Pose[], wish: Pose) {
    const pieces = sizes.map(([width, depth]) => piece("side_table", width, depth));
    const last = pieces.length - 1;
    const reach = Math.ceil(Math.hypot(floorOfOracle.width_m, floorOfOracle.length_m) / oracleStep);

    const result = placeNearest(pieces, [...fixed, wish], floorOfOracle, { ...aimed, step: oracleStep });

    let nearest = Infinity;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const problems = findProblems(pieces, [...fixed, at(wish.x_m + dx * oracleStep, wish.z_m + dz * oracleStep)], floorOfOracle, aimed);
        const fine = !problems.overlaps.some(({ a, b }) => a === last || b === last) && !problems.outside.some(({ piece: index }) => index === last);
        if (fine) nearest = Math.min(nearest, dx * dx + dz * dz);
      }
    }
    const found = result.unplaced.includes(last)
      ? Infinity
      : Math.round((result.poses[last].x_m - wish.x_m) / oracleStep) ** 2 + Math.round((result.poses[last].z_m - wish.z_m) / oracleStep) ** 2;
    return { nearest, found, untouched: result.poses.slice(0, last) };
  }

  it("finds a place that is as near as the nearest of all the places in the room, and none only when there is none", () => {
    const next = random(77);
    const between = (low: number, high: number) => low + next() * (high - low);
    let moved = 0;
    let stuck = 0;

    for (let run = 0; run < 40; run++) {
      const bigs = Array.from({ length: 2 }, () => [Math.round(between(100, 180)), Math.round(between(80, 120))]);
      const bigPieces = bigs.map(([width, depth]) => piece("sofa", width, depth));
      let fixed: Pose[];
      do {
        fixed = bigs.map(() => at(between(-1.6, 1.6), between(-1.1, 1.1)));
      } while (!isValid(findProblems(bigPieces, fixed, floorOfOracle, aimed)));
      const small = [Math.round(between(30, 70)), Math.round(between(30, 70))];

      const { nearest, found, untouched } = nearestAndFound([...bigs, small], fixed, at(between(-2.2, 2.2), between(-1.7, 1.7)));

      expect(untouched, `${run}`).toEqual(fixed);
      expect(found, `${run}`).toBe(nearest);
      if (found === Infinity) stuck++;
      else if (found > 0) moved++;
    }
    // Not a test of a room in which nothing has to move, or in which nothing fits.
    expect(moved).toBeGreaterThan(10);
    expect(stuck).toBeLessThan(20);
  }, 30_000);

  it.each([
    {
      name: "three pieces in a row, and the table asked for between the first two",
      bigs: [[110, 119], [130, 115], [107, 121]],
      fixed: [at(-1.345, 0.259), at(-0.098, -0.018), at(1.406, 0.424)],
      small: [49, 45],
      wish: at(-0.416, -0.078),
    },
    {
      name: "four pieces round the room, and the table asked for beside the left wall",
      bigs: [[135, 114], [130, 98], [92, 123], [115, 130]],
      fixed: [at(-1.239, -0.598), at(1.188, 0.982), at(-1.16, 0.693), at(1.113, -0.341)],
      small: [43, 57],
      wish: at(-2.189, -0.767),
    },
    {
      name: "four pieces, and the table asked for near the back wall",
      bigs: [[107, 92], [165, 83], [174, 93], [130, 90]],
      fixed: [at(-1.208, 0.961), at(-0.946, -0.784), at(0.805, -0.534), at(0.021, 0.775)],
      small: [39, 49],
      wish: at(0.761, -1.604),
    },
  ])("finds the nearest place when the first ring that has a free place has only a far one: $name", ({ bigs, fixed, small, wish }) => {
    // A place in the first ring that has a free place is not always the nearest: a place in a ring a little further out, straight across, can be nearer.
    const { nearest, found, untouched } = nearestAndFound([...bigs, small], fixed, wish);

    expect(untouched).toEqual(fixed);
    expect(nearest).toBeLessThan(Infinity);
    expect(found).toBe(nearest);
  }, 30_000);
});

describe("adjustedPieces: which pieces were moved or turned", () => {
  it("lists the pieces that are not where they were, by place in the list", () => {
    expect(adjustedPieces([at(0, 0), at(1, 1), at(2, 2)], [at(0.3, 0.4), at(1, 1), at(2, 2.5)])).toEqual([0, 2]);
  });

  it("does not count a move of less than half a centimetre", () => {
    expect(adjustedPieces([at(0, 0), at(0, 0)], [at(0.003, 0), at(0, 0.01)])).toEqual([1]);
  });

  it("counts a move along x alone, and one along z alone", () => {
    expect(adjustedPieces([at(0, 0), at(0, 0)], [at(0.01, 0), at(0, 0.01)])).toEqual([0, 1]);
  });

  it("counts a piece that was turned, but not one that is turned by less than a degree, or by a whole circle", () => {
    expect(adjustedPieces([at(0, 0, 0)], [at(0, 0, 90)])).toEqual([0]);
    expect(adjustedPieces([at(0, 0, 0), at(0, 0, 0), at(0, 0, 350)], [at(0, 0, 0.5), at(0, 0, 360), at(0, 0, -10)])).toEqual([]);
    expect(adjustedPieces([at(0, 0, 350)], [at(0, 0, 10)])).toEqual([0]);
    expect(adjustedPieces([at(0, 0, 0)], [at(0, 0, 2)])).toEqual([0]);
  });
});

describe("fixLayout: make a layout fine, if it can be", () => {
  const pieces = [sofa, table, piece("armchair", 80, 85), piece("tv_stand", 140, 45), rug];
  const fine = [at(0, 1.4, 180), at(0, 0.2), at(-1.8, 0.4, 90), at(0, -1.7), at(0, 0.5)];

  it("leaves a layout that is fine exactly as it is, also one whose pieces only touch", () => {
    const touching = [at(0, 0), at(2, 0), at(0, 2), at(-2, 0)];

    const result = fixLayout([sofa, sofa, sofa, sofa], touching, { width_m: 6, length_m: 6 });

    expect(result).toEqual({ ok: true, poses: touching, adjusted: [], attempts: 0 });
    expect(fixLayout(pieces, fine, room)).toEqual({ ok: true, poses: fine, adjusted: [], attempts: 0 });
  });

  it("fixes overlapping pieces and a piece through a wall, and says which pieces it moved", () => {
    const flawed = [at(0, 1.4, 180), at(0, 0.9), at(-1.8, 0.4, 90), at(0, -2), at(0, 0.5)];

    const result = fixLayout(pieces, flawed, room);

    expect(result.ok).toBe(true);
    expect(isValid(findProblems(pieces, result.poses, room))).toBe(true);
    // The table was in the sofa, so both were pushed, the table the further as it is the lighter, and the TV stand was through the wall; the armchair and the rug were fine.
    expect(result.adjusted).toEqual([0, 1, 3]);
    expect(Math.abs(result.poses[1].z_m - flawed[1].z_m)).toBeGreaterThan(Math.abs(result.poses[0].z_m - flawed[0].z_m));
    expect(result.poses[2]).toEqual(flawed[2]);
    expect(result.poses[4]).toEqual(flawed[4]);
  });

  it("does not turn anything when it can fix the layout without, and does not lose a piece", () => {
    const next = random(3);
    for (let run = 0; run < 100; run++) {
      const poses = nearlyRight(fine, 0.3, 0.1, next);

      const result = fixLayout(pieces, poses, room);

      expect(result.ok).toBe(true);
      expect(result.poses).toHaveLength(poses.length);
      expect(result.poses.map((pose) => pose.rotation_deg)).toEqual(poses.map((pose) => pose.rotation_deg));
    }
  });

  it("turns pieces that are at an angle to the nearest quarter turn when that is the only way to make the layout fine", () => {
    // A bookshelf 2 m long and 1 m deep in a room of 2.1 m x 1.6 m fits along a wall, but at 20 degrees its box is 2.22 m x 1.62 m: too big for the room.
    const tight: Floor = { width_m: 2.1, length_m: 1.6 };
    const shelf = piece("bookshelf", 200, 100);

    const result = fixLayout([shelf], [at(0, 0, 20)], tight);

    expect(result.ok).toBe(true);
    expect(result.poses[0].rotation_deg).toBe(0);
    expect(result.adjusted).toEqual([0]);
    expect(isValid(findProblems([shelf], result.poses, tight))).toBe(true);
  });

  it("turns the pieces that are at an angle even when the others are at a quarter turn already", () => {
    const tight: Floor = { width_m: 2.1, length_m: 1.6 };
    const shelf = piece("bookshelf", 200, 100);
    const tiny = piece("side_table", 20, 20);

    const result = fixLayout([shelf, tiny], [at(0, 0, 20), at(0, 0.65)], tight);

    expect(result.ok).toBe(true);
    expect(result.poses[0].rotation_deg).toBe(0);
    expect(result.poses[1]).toEqual(at(0, 0.65));
    expect(result.adjusted).toEqual([0]);
  });

  it.each([
    [10, 0, 2.1, 1.6],
    [350, 0, 2.1, 1.6],
    [170, 180, 2.1, 1.6],
    [190, 180, 2.1, 1.6],
    [80, 90, 1.6, 2.1],
    [100, 90, 1.6, 2.1],
    [260, 270, 1.6, 2.1],
    [280, 270, 1.6, 2.1],
  ])("turns a piece at %s degrees to the nearest quarter turn, %s, and keeps it where it was put", (angle, turned, width_m, length_m) => {
    // A bookshelf 2 m x 1 m only fits a room this size along its long side, so it has to be straightened, the right way.
    const shelf = piece("bookshelf", 200, 100);

    const result = fixLayout([shelf], [at(0.02, 0.2, angle)], { width_m, length_m });

    expect(result.ok).toBe(true);
    expect(result.poses[0].rotation_deg).toBe(turned);
    expect(result.poses[0].x_m).toBeCloseTo(0.02, 9);
  });

  it("does not turn a piece that is already at a quarter turn, and says that it is not fine when two pieces cross whatever it does", () => {
    // Two long thin pieces, each across the whole of a room of 1 m x 1 m in a different way, cross wherever they are put.
    const tight: Floor = { width_m: 1, length_m: 1 };
    const across = piece("bookshelf", 100, 10);
    const along = piece("bookshelf", 10, 100);

    const result = fixLayout([across, along], [at(0, 0, 0), at(0, 0, 0)], tight);

    expect(result.ok).toBe(false);
    expect(result.poses.map((pose) => pose.rotation_deg)).toEqual([0, 0]);
  });

  it("goes on with the search where the repair is stuck", () => {
    const wrong = [at(-0.18, 1.8, 90), at(0, 0.2), at(-1.93, 0.17, 90), at(0, -1.58, -90), at(0, 0.5)];

    const result = fixLayout(pieces, wrong, room);

    expect(result.ok).toBe(true);
    expect(isValid(findProblems(pieces, result.poses, room))).toBe(true);
  });

  it("goes on with smaller gaps when the room is too full for the usual ones, down to pieces that touch", () => {
    // Six squares of 1 m on a floor of 3 m x 3 m: 67% of it. With 3 cm between them only four would fit, with none all six do.
    const square = piece("side_table", 100, 100);
    const small: Floor = { width_m: 3, length_m: 3 };
    const six = Array.from({ length: 6 }, () => square);

    const result = fixLayout(six, six.map(() => at(0, 0)), small);

    expect(result.ok).toBe(true);
    expect(isValid(findProblems(six, result.poses, small))).toBe(true);
    // Not all of them could have the usual gap, or there would be room for them.
    expect(isValid(findProblems(six, result.poses, small, { gap: 0.03, wallGap: 0.02 }))).toBe(false);
  });

  it("uses the usual gaps when the room has room for them", () => {
    // Four squares of 1 m on a floor of 3 m x 3 m, each in the others, as if the AI had them too close together.
    const square = piece("side_table", 100, 100);
    const four = Array.from({ length: 4 }, () => square);
    const floor: Floor = { width_m: 3, length_m: 3 };

    const result = fixLayout(four, [at(-0.4, -0.4), at(0.4, -0.4), at(-0.4, 0.4), at(0.4, 0.4)], floor);

    expect(result.ok).toBe(true);
    expect(isValid(findProblems(four, result.poses, floor, { gap: 0.03 - 1e-6, wallGap: 0.02 - 1e-6 }))).toBe(true);
  });

  it("aims for 1 cm between pieces when the room is too full for 3 cm, but has room for more than touching", () => {
    // Two pieces 0.79 m and 0.41 m deep, one behind the other in a room 1.24 m long: with 3 cm between them and 2 cm to each wall they would need 1.27 m, with 1 cm 1.21 m.
    const floor: Floor = { width_m: 1.83, length_m: 1.24 };
    const first = piece("side_table", 127, 79);
    const second = piece("side_table", 70, 41);

    const result = fixLayout([first, second], [at(-0.52, -0.25), at(-0.38, 0.01)], floor);

    expect(result.ok).toBe(true);
    expect(result.poses[0].x_m).toBeCloseTo(-0.28, 9);
    expect(result.poses[0].z_m).toBeCloseTo(-0.225, 9);
    expect(result.poses[1].x_m).toBeCloseTo(-0.38, 9);
    expect(result.poses[1].z_m - 0.41 / 2 - (result.poses[0].z_m + 0.79 / 2)).toBeCloseTo(0.01, 9);
  });

  // What fixLayout tries, as the notes on it say: gaps of 3 cm to pieces and 2 cm to walls, then 1 cm and none, then none at all.
  const attempts = (pieces: Piece[], poses: Pose[], floor: Floor) =>
    [
      { gap: 0.03, wallGap: 0.02 },
      { gap: 0.01, wallGap: 0 },
      { gap: 0, wallGap: 0 },
    ].map((gaps) => {
      const repaired = repair(pieces, poses, floor, gaps).poses;
      const made = isValid(findProblems(pieces, repaired, floor)) ? repaired : placeNearest(pieces, repaired, floor, gaps).poses;
      const problems = findProblems(pieces, made, floor);
      return { poses: made, problems: problems.overlaps.length + problems.outside.length };
    });

  it.each([
    {
      name: "the first is the worst and the other two are as good",
      floor: { width_m: 2.67, length_m: 2.38 },
      sizes: [[86, 140], [130, 147], [76, 85]],
      given: [at(0.81, -0.54), at(-0.55, 0.63), at(-1.32, 0.38)],
      counts: [3, 2, 2],
    },
    {
      name: "the first is the best, with fewer overlaps and more pieces through a wall",
      floor: { width_m: 1.96, length_m: 1.66 },
      sizes: [[104, 149], [107, 76], [81, 146], [78, 131]],
      given: [at(0.44, 0.16), at(-0.97, -0.11), at(0.83, -0.83), at(0.52, -0.01)],
      counts: [4, 5, 5],
    },
  ])("gives the attempt with the fewest problems when nothing makes the layout fine, the first of them if two are as good: $name", ({ floor, sizes, given, counts }) => {
    const pieces = sizes.map(([width, depth]) => piece("side_table", width, depth));
    const made = attempts(pieces, given, floor);
    expect(made.map((attempt) => attempt.problems)).toEqual(counts);

    const result = fixLayout(pieces, given, floor);

    const best = made.find((attempt) => attempt.problems === Math.min(...counts))!;
    expect(result.ok).toBe(false);
    expect(result.poses).toEqual(best.poses);
    expect(result.adjusted).toEqual(adjustedPieces(given, best.poses));
    expect(result.adjusted.length).toBeGreaterThan(0);
  });

  it("gives the attempt that has the fewest problems when nothing makes the layout fine", () => {
    const tiny: Floor = { width_m: 2.2, length_m: 1.2 };
    const poses = [at(0, 0), at(0.1, 0.1), at(-0.1, 0)];
    const pieces3 = [sofa, sofa, table];

    const result = fixLayout(pieces3, poses, tiny);

    const before = findProblems(pieces3, poses, tiny);
    const after = findProblems(pieces3, result.poses, tiny);
    expect(after.overlaps.length + after.outside.length).toBeLessThanOrEqual(before.overlaps.length + before.outside.length);
  });

  it("says that it is not fine when the room cannot hold the pieces, with the layout as far as it got", () => {
    const tiny: Floor = { width_m: 2.2, length_m: 1.2 };

    const result = fixLayout([sofa, sofa, table], [at(0, 0), at(0.1, 0.1), at(-0.1, 0)], tiny);

    expect(result.ok).toBe(false);
    expect(result.poses).toHaveLength(3);
  });

  it("does not change what it was given", () => {
    const given = [at(0, 0), at(0.1, 0.1)];
    const copy = JSON.parse(JSON.stringify(given));

    fixLayout([sofa, table], given, room);

    expect(given).toEqual(copy);
  });
});

describe("fixLayout: three attempts, and then it gives up (US-22 AC3)", () => {
  const square = piece("side_table", 100, 100);
  const floor3: Floor = { width_m: 3, length_m: 3 };

  it("makes three attempts at most", () => {
    expect(FIX_ATTEMPTS).toBe(3);
  });

  it("makes none for a layout that is fine as it was given, also one whose pieces only touch", () => {
    // Two sofas of 2 m side by side, touching in the middle of the room.
    expect(fixLayout([sofa, sofa], [at(-1, 0), at(1, 0)], room).attempts).toBe(0);
    expect(fixLayout([sofa, table], [at(0, 1.4, 180), at(0, 0.2)], room).attempts).toBe(0);
  });

  it("is done with the first attempt when the room has room for the usual gaps, and then makes no other", () => {
    // Four squares of 1 m on a floor of 3 m x 3 m, each in the others, as if the AI had them too close together.
    const four = Array.from({ length: 4 }, () => square);

    const result = fixLayout(four, [at(-0.4, -0.4), at(0.4, -0.4), at(-0.4, 0.4), at(0.4, 0.4)], floor3);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(isValid(findProblems(four, result.poses, floor3, { gap: 0.03 - 1e-6, wallGap: 0.02 - 1e-6 }))).toBe(true);
  });

  it("needs the second attempt when the room is too full for 3 cm between pieces, and aims for 1 cm in it", () => {
    // Two pieces 0.79 m and 0.41 m deep, one behind the other in a room 1.24 m long: with 3 cm between them and 2 cm to each wall they would need 1.27 m, with 1 cm 1.21 m.
    const narrow: Floor = { width_m: 1.83, length_m: 1.24 };
    const pieces2 = [piece("side_table", 127, 79), piece("side_table", 70, 41)];

    const result = fixLayout(pieces2, [at(-0.52, -0.25), at(-0.38, 0.01)], narrow);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("needs the third attempt when the room is too full for 1 cm too, and lets the pieces touch in it", () => {
    // Six squares of 1 m on a floor of 3 m x 3 m: 67% of it. Only with pieces that touch do all six fit.
    const six = Array.from({ length: 6 }, () => square);

    const result = fixLayout(six, six.map(() => at(0, 0)), floor3);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it("gives up when the three attempts have not made the layout fine, with a layout that is not, and says that all three were made", () => {
    const tiny: Floor = { width_m: 2.2, length_m: 1.2 };

    const result = fixLayout([sofa, sofa, table], [at(0, 0), at(0.1, 0.1), at(-0.1, 0)], tiny);

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(FIX_ATTEMPTS);
    expect(isValid(findProblems([sofa, sofa, table], result.poses, tiny))).toBe(false);
  });

  describe("a room that is crowded, but could hold its pieces", () => {
    const pieces = crowdedRoom.furniture;
    const floor = crowdedRoom.room;

    it("has an arrangement that is fine, which is what makes an answer that cannot be fixed a failure of the fixing and not of the room", () => {
      expect(isValid(findProblems(pieces, CROWDED_FINE, floor))).toBe(true);
    });

    it("gives up on an answer that is nearly that arrangement, after all three attempts, and does not make it fine by turning or losing a piece", () => {
      const result = fixLayout(pieces, CROWDED_UNFIXABLE, floor);

      expect(result.ok).toBe(false);
      expect(result.attempts).toBe(FIX_ATTEMPTS);
      expect(result.poses).toHaveLength(pieces.length);
      expect(isValid(findProblems(pieces, result.poses, floor))).toBe(false);
      expect(result.poses.map((pose) => pose.rotation_deg)).toEqual(CROWDED_UNFIXABLE.map((pose) => pose.rotation_deg));
    });

    it("leaves the arrangement that is fine as it is", () => {
      expect(fixLayout(pieces, CROWDED_FINE, floor)).toEqual({ ok: true, poses: CROWDED_FINE, adjusted: [], attempts: 0 });
    });
  });

  describe("a piece at an angle", () => {
    // A sofa at -20 degrees in a room that is a little too full: its box is 2.19 m wide, in a room of 2.4 m. The coffee table and the side table
    // are turned the other way round, which is fine, and are at quarter turns already.
    const tight: Floor = { width_m: 2.4, length_m: 1.9 };
    const angled = [piece("sofa", 200, 90), piece("coffee_table", 100, 60), piece("side_table", 45, 45)];
    const given = [at(-0.16, -0.69, -20), at(0.32, 0.19, 180), at(-0.76, 0.29, 180)];

    it("is made a quarter turn in the first attempt that does not work with the angle, before the next attempt asks for smaller gaps", () => {
      const result = fixLayout(angled, given, tight);

      expect(result.ok).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.poses.map((pose) => pose.rotation_deg)).toEqual([0, 180, 180]);
      expect(result.adjusted).toContain(0);
      // With the usual gaps of the first attempt: not the 1 cm of the second, in which the angle would have been kept.
      expect(isValid(findProblems(angled, result.poses, tight, { gap: 0.03 - 1e-6, wallGap: 0.02 - 1e-6 }))).toBe(true);
    });

    it("keeps its angle in an attempt in which the layout can be fixed with it: only what is in the way is moved", () => {
      const roomy: Floor = { width_m: 2.4, length_m: 3.8 };

      // The coffee table is in the sofa, which pushing the two apart fixes, with the sofa at its angle.
      const result = fixLayout(angled, [at(0, -1, -20), at(0, -0.6, 180), at(-0.8, 1.2, 180)], roomy);

      expect(result.ok).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.poses.map((pose) => pose.rotation_deg)).toEqual([-20, 180, 180]);
      expect(result.adjusted.length).toBeGreaterThan(0);
    });

    it("is left at its angle when the angle works, and the layout is fine in the first attempt", () => {
      // The same sofa in a room as wide as the old one but twice as long, with the others out of its way.
      const roomy: Floor = { width_m: 2.4, length_m: 3.8 };

      const result = fixLayout(angled, [at(0, -1, -20), at(0.3, 0.9, 180), at(-0.8, 1.2, 180)], roomy);

      expect(result.attempts).toBe(0);
      expect(result.poses[0].rotation_deg).toBe(-20);
    });
  });
});
