import { describe, expect, it } from "vitest";
import { findProblems, footprintOf, isValid, movement, perturb, placeNearest, placeOnGrid, random, repair, type Piece, type Pose, type Room } from "./overlap-approaches";

const room: Room = { width_m: 5, length_m: 4 };
const piece = (label: string, width_cm: number, depth_cm: number): Piece => ({ label, width_cm, depth_cm });
const at = (x_m: number, z_m: number, rotation_deg = 0): Pose => ({ x_m, z_m, rotation_deg });

const sofa = piece("sofa", 200, 90);
const table = piece("coffee_table", 100, 60);
const rug = piece("rug", 160, 230);

describe("findProblems: the check of the footprints", () => {
  it("finds nothing wrong with pieces that are apart and inside the room", () => {
    const problems = findProblems([sofa, table], [at(0, 1.4, 180), at(0, 0.3)], room);

    expect(problems).toEqual({ overlaps: [], outside: [] });
    expect(isValid(problems)).toBe(true);
  });

  it("finds a pair that is in each other, by place in the list, with the area they share", () => {
    const problems = findProblems([sofa, table, sofa], [at(0, 1.4, 180), at(0, 0.8), at(-2, -1)], room);

    expect(problems.overlaps).toHaveLength(1);
    expect(problems.overlaps[0]).toMatchObject({ a: 0, b: 1 });
    // The table covers z from 0.5 to 1.1 and the sofa from 0.95: 0.15 m deep and 1 m wide.
    expect(problems.overlaps[0].area_m2).toBeCloseTo(0.15, 9);
    expect(isValid(problems)).toBe(false);
  });

  it("does not count pieces that only touch", () => {
    expect(findProblems([sofa, sofa], [at(0, 0), at(2, 0)], room).overlaps).toEqual([]);
  });

  it("lets a rug lie under other pieces, but not through a wall", () => {
    const under = findProblems([rug, sofa, table], [at(0, 0.5), at(0, 0.5), at(0, 0.5)], room);

    expect(under.overlaps.map(({ a, b }) => [a, b])).toEqual([[1, 2]]);
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

describe("repair: check, then fix in code", () => {
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
    const moved = movement(overlapping, result.poses);
    expect(moved.turned).toBe(0);
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

  it("leaves 3 cm between pieces and 2 cm to the walls when it is not told otherwise", () => {
    const result = repair([sofa, table], [at(0, -1.9), at(0, -1.5)], room);

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

  it("gives up after its rounds when the room cannot hold the pieces, without losing or breaking anything", () => {
    const tiny: Room = { width_m: 2.2, length_m: 1.2 };
    const poses = [at(0, 0), at(0.1, 0.1), at(-0.1, 0)];

    const result = repair([sofa, sofa, table], poses, tiny, { rounds: 50 });

    expect(result.rounds).toBe(50);
    expect(result.poses).toHaveLength(3);
    for (const pose of result.poses) expect(Number.isFinite(pose.x_m) && Number.isFinite(pose.z_m)).toBe(true);
    expect(isValid(findProblems([sofa, sofa, table], result.poses, tiny))).toBe(false);
  });

  it("centres a piece that is bigger than the room, instead of pushing it back and forth", () => {
    const small: Room = { width_m: 1.5, length_m: 3 };

    const result = repair([sofa], [at(0.4, 0.3)], small, { rounds: 20 });

    expect(result.poses[0].x_m).toBeCloseTo(0, 9);
  });

  it("makes every random layout of a roomy room that is off in its positions fine", () => {
    const next = random(21);
    const reference = [at(0, 1.4, 180), at(0, 0.3), at(-1.8, 0.4, 90), at(0, -1.7)];
    let changed = 0;
    for (let run = 0; run < 300; run++) {
      const poses = perturb(reference, 0.3, 0, next);

      const result = repair(pieces, poses, room, { gap: 0.03, wallGap: 0.02 });

      // What the repair says it did, checked the other way: by the check of the footprints, a little less strict.
      expect(isValid(findProblems(pieces, result.poses, room, { gap: 0.03 - 1e-6, wallGap: 0.02 - 1e-6 })), `${run}`).toBe(true);
      if (!isValid(findProblems(pieces, poses, room))) changed++;
    }
    // Most of them were not fine to begin with, so this is not a test of a repair that has nothing to do.
    expect(changed).toBeGreaterThan(150);
  });

  it("has a known limit: pieces that were turned the wrong way, and now have to stand end to end along the room, are only pushed along that line", () => {
    // The sofa and the TV stand are turned a quarter, so they reach 2 m and 1.4 m along the 4 m room, and with the table
    // between them they would need 4 m and the gaps: no room. They would have to be spread sideways, which is not the way
    // the shortest push goes, so the repair is stuck. A real layout would be asked for again.
    const wrong = [at(-0.18, 1.8, 90), at(0, 0.2), at(-1.93, 0.17, 90), at(0, -1.58, -90)];

    const result = repair(pieces, wrong, room, { gap: 0.03, wallGap: 0.02 });

    expect(isValid(findProblems(pieces, result.poses, room, { gap: 0.03 - 1e-6, wallGap: 0.02 - 1e-6 }))).toBe(false);
    expect(result.rounds).toBe(300);
  });
});

describe("movement: how far the pieces were moved", () => {
  it("gives the mean and the greatest move in cm, how many pieces moved and how many were turned", () => {
    const before = [at(0, 0), at(1, 1), at(2, 2, 90)];
    const after = [at(0.3, 0.4), at(1, 1), at(2, 2, 180)];

    const result = movement(before, after);

    expect(result.max_cm).toBeCloseTo(50, 9);
    expect(result.mean_cm).toBeCloseTo(50 / 3, 9);
    expect(result.moved).toBe(1);
    expect(result.turned).toBe(1);
  });

  it("does not count a move of less than half a centimetre as a piece moved", () => {
    expect(movement([at(0, 0), at(0, 0)], [at(0.003, 0), at(0, 0.01)]).moved).toBe(1);
  });

  it("sees a turn of 360 degrees, or from 350 to 10, as the small or no turn it is", () => {
    expect(movement([at(0, 0, 0)], [at(0, 0, 360)]).turned).toBe(0);
    expect(movement([at(0, 0, 350)], [at(0, 0, -10)]).turned).toBe(0);
    expect(movement([at(0, 0, 350)], [at(0, 0, 10)]).turned).toBe(1);
  });
});

describe("placeOnGrid: the pieces on a grid of cells", () => {
  const stuff = [sofa, table, piece("armchair", 80, 85), piece("bed", 160, 200), piece("desk", 120, 60)];

  it("puts a piece on whole cells, with its middle in the middle of its block, and turns it to the nearest quarter", () => {
    const result = placeOnGrid([sofa], [at(0.1, 0.2, 80)], room, 0.5);

    // Turned a quarter the sofa is 0.9 m across and 2 m along: 2 x 4 cells of 0.5 m, so 1 m x 2 m.
    expect(result.poses[0].rotation_deg).toBe(90);
    expect(result.unplaced).toEqual([]);
    expect(result.poses[0].x_m).toBeCloseTo(0, 9);
    expect(result.poses[0].z_m).toBeCloseTo(0, 9);
    expect(result.wasted).toBeCloseTo((4 * 0.25 * 2 - 1.8) / 1.8, 9);
  });

  it("gives the biggest piece the place it asked for, whatever its place in the list, and moves the smaller one", () => {
    const result = placeOnGrid([table, sofa], [at(0, 0), at(0, 0)], room, 0.25);

    expect(result.poses[1].x_m).toBeCloseTo(0, 9);
    expect(result.poses[1].z_m).toBeCloseTo(0, 9);
    expect(movement([at(0, 0)], [result.poses[0]]).moved).toBe(1);
  });

  it("takes the nearest free place when two pieces are asked to be in the same one", () => {
    const result = placeOnGrid([sofa, sofa], [at(0, 0), at(0, 0)], room, 0.25);

    expect(isValid(findProblems([sofa, sofa], result.poses, room))).toBe(true);
    expect(result.unplaced).toEqual([]);
    expect(movement([at(0, 0), at(0, 0)], result.poses).moved).toBeGreaterThan(0);
  });

  it("only rounds when it is not asked to keep pieces out of each other's cells: the overlap stays", () => {
    const result = placeOnGrid([sofa, sofa], [at(0, 0), at(0.1, 0)], room, 0.25, { enforce: false });

    expect(findProblems([sofa, sofa], result.poses, room).overlaps).toHaveLength(1);
  });

  it("keeps every piece inside the room and no two pieces in each other, whatever the layout it is given", () => {
    const next = random(5);
    let placed = 0;
    for (let run = 0; run < 200; run++) {
      const poses = stuff.map(() => at((next() - 0.5) * 6, (next() - 0.5) * 5, next() * 360));

      const result = placeOnGrid(stuff, poses, room, 0.25);

      if (result.unplaced.length > 0) continue;
      placed++;
      expect(isValid(findProblems(stuff, result.poses, room)), `${run}`).toBe(true);
    }
    expect(placed).toBeGreaterThan(150);
  });

  it("says which pieces found no place: one that is bigger than the room, and the one that is left when the room is full", () => {
    const tiny: Room = { width_m: 2, length_m: 2 };

    expect(placeOnGrid([sofa], [at(0, 0, 90)], { width_m: 1, length_m: 1.5 }, 0.5).unplaced).toEqual([0]);
    expect(placeOnGrid([piece("bed", 190, 190), table], [at(0, 0), at(0.2, 0)], tiny, 0.5).unplaced).toEqual([1]);
  });

  it("gives a rug no cells, so another piece can stand where it lies", () => {
    const result = placeOnGrid([rug, sofa], [at(0, 0), at(0, 0)], room, 0.25);

    expect(result.unplaced).toEqual([]);
    expect(result.poses[1].x_m).toBeCloseTo(0, 9);
    expect(result.poses[1].z_m).toBeCloseTo(0, 9);
  });

  it("keeps a small rug where it was put, though another piece is there already", () => {
    const small = piece("rug", 60, 90);

    const result = placeOnGrid([sofa, small], [at(0, 0), at(0, 0)], room, 0.25);

    expect(result.unplaced).toEqual([]);
    // Its block of 3 x 4 cells cannot have its middle exactly there, but it is within half a cell of it, not moved out from under the sofa.
    expect(Math.hypot(result.poses[1].x_m, result.poses[1].z_m)).toBeLessThan(0.25);
  });

  it("wastes less space the smaller the cells are", () => {
    const waste = [0.5, 0.25, 0.1].map((cell) => placeOnGrid(stuff, stuff.map((_, index) => at(-1.5 + index * 0.9, -1)), room, cell).wasted);

    expect(waste[0]).toBeGreaterThan(waste[1]);
    expect(waste[1]).toBeGreaterThan(waste[2]);
  });

  it("puts the middle of every piece on the grid, so that the 3D room can use the cells", () => {
    const result = placeOnGrid(stuff, stuff.map((_, index) => at(index - 2, 0.3 * index - 0.5)), room, 0.5);

    const feet = result.poses.map((pose, index) => footprintOf(stuff[index], pose));
    expect(feet.length).toBe(5);
    for (const pose of result.poses) {
      // Blocks are whole cells and the grid is centred on the room, so the middle is a multiple of half a cell.
      expect(((pose.x_m / 0.25) % 1) + 1e-9).toBeLessThan(2e-9);
      expect(((pose.z_m / 0.25) % 1) + 1e-9).toBeLessThan(2e-9);
    }
  });
});

describe("perturb: a layout that is nearly right", () => {
  const reference = [at(0, 1), at(1, -1, 90), at(-1, 0.5, 180)];

  it("is the same layout when there is no error, and the same every time for the same seed", () => {
    expect(perturb(reference, 0, 0, random(1))).toEqual(reference);
    expect(perturb(reference, 0.2, 0.3, random(9))).toEqual(perturb(reference, 0.2, 0.3, random(9)));
    expect(perturb(reference, 0.2, 0.3, random(9))).not.toEqual(perturb(reference, 0.2, 0.3, random(10)));
  });

  it("is off by about the error asked for, on average", () => {
    const next = random(2);
    const errors: number[] = [];
    for (let run = 0; run < 3000; run++) {
      const [pose] = perturb([at(0, 0)], 0.2, 0, next);
      errors.push(pose.x_m, pose.z_m);
    }

    const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    const spread = Math.sqrt(errors.reduce((sum, value) => sum + (value - mean) ** 2, 0) / errors.length);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(spread).toBeGreaterThan(0.19);
    expect(spread).toBeLessThan(0.21);
  });

  it("turns pieces a quarter the wrong way at the rate asked for, and never any other way", () => {
    const next = random(4);
    let turns = 0;
    const total = 4000;
    for (let run = 0; run < total; run++) {
      const [pose] = perturb([at(0, 0, 0)], 0, 0.25, next);
      if (pose.rotation_deg !== 0) {
        turns++;
        expect(Math.abs(pose.rotation_deg)).toBe(90);
      }
    }
    expect(turns / total).toBeGreaterThan(0.22);
    expect(turns / total).toBeLessThan(0.28);
  });
});

describe("placeNearest: look for a free place in the exact geometry", () => {
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

  it("does not turn anything, and only keeps a rug in the room", () => {
    const result = placeNearest([rug, sofa], [at(2.4, 0, 30), at(0, 0.5, 90)], room);

    expect(result.poses.map((pose) => pose.rotation_deg)).toEqual([30, 90]);
    expect(isValid(findProblems([rug], [result.poses[0]], room))).toBe(true);
    expect(result.poses[1]).toEqual(at(0, 0.5, 90));
  });

  it("leaves the gaps to the pieces and the walls that it is asked for", () => {
    const next = random(8);
    const reference = [at(0, 1.4, 180), at(0, 0.3), at(-1.8, 0.4, 90), at(0, -1.7)];
    for (let run = 0; run < 100; run++) {
      const result = placeNearest(pieces, perturb(reference, 0.3, 0.1, next), room, { gap: 0.1, wallGap: 0.1 });

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
    const tiny: Room = { width_m: 2.2, length_m: 1.2 };
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
});
