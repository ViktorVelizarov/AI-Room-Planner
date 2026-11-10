import { Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { footprintBounds, footprintCorners, outsideRoom, overlap, overlapArea, type Footprint } from "./footprint";

const piece = (x_m: number, z_m: number, width_m: number, depth_m: number, rotation_deg = 0): Footprint => ({ x_m, z_m, width_m, depth_m, rotation_deg });

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
const between = (next: () => number, low: number, high: number) => low + (high - low) * next();
const randomPiece = (next: () => number): Footprint =>
  piece(between(next, -1.5, 1.5), between(next, -1.5, 1.5), between(next, 0.2, 2), between(next, 0.2, 2), between(next, 0, 360));

describe("footprintCorners: a footprint is a rectangle on the floor", () => {
  it("has the corners of a rectangle around its middle when it is not turned", () => {
    const corners = footprintCorners(piece(1, 2, 4, 2));

    expect(corners.map(({ x, z }) => [x, z])).toEqual([
      [-1, 1],
      [3, 1],
      [3, 3],
      [-1, 3],
    ]);
  });

  it("swaps the width and the depth when turned a quarter, in either direction", () => {
    for (const turn of [90, 270, -90]) {
      const { minX, maxX, minZ, maxZ } = footprintBounds(piece(0, 0, 4, 2, turn));

      expect([maxX - minX, maxZ - minZ].map((value) => Math.round(value * 1e9) / 1e9), `${turn}`).toEqual([2, 4]);
    }
  });

  it("turns the front towards +x for a positive angle, which is how Three.js turns an object, so the 3D room and the checks agree", () => {
    const next = random(7);
    for (let run = 0; run < 50; run++) {
      const footprint = randomPiece(next);
      const object = new Object3D();
      object.position.set(footprint.x_m, 0, footprint.z_m);
      object.rotation.y = (footprint.rotation_deg * Math.PI) / 180;
      object.updateMatrixWorld();

      const expected = [-1, 1, 1, -1].map((a, index) => {
        const b = [-1, -1, 1, 1][index];
        return object.localToWorld(new Vector3((a * footprint.width_m) / 2, 0, (b * footprint.depth_m) / 2));
      });
      footprintCorners(footprint).forEach((corner, index) => {
        expect(corner.x).toBeCloseTo(expected[index].x, 9);
        expect(corner.z).toBeCloseTo(expected[index].z, 9);
      });
    }
  });

  it("takes the middle of the front edge, which is at +z when it is not turned, to +x when it is turned 90 degrees", () => {
    // The corners go round from the back left, so the last two are the ones at the front.
    const front = (rotation: number) => {
      const [, , frontRight, frontLeft] = footprintCorners(piece(0, 0, 2, 2, rotation));
      return { x: (frontRight.x + frontLeft.x) / 2, z: (frontRight.z + frontLeft.z) / 2 };
    };

    expect(front(0).z).toBeCloseTo(1, 9);
    expect(front(90).x).toBeCloseTo(1, 9);
    expect(front(180).z).toBeCloseTo(-1, 9);
    expect(front(270).x).toBeCloseTo(-1, 9);
  });

  it("goes round the same way whatever the turn, so that the area is always positive", () => {
    const next = random(17);
    for (let run = 0; run < 50; run++) {
      const corners = footprintCorners(randomPiece(next));
      const area = corners.reduce((sum, corner, index) => sum + (corner.x * corners[(index + 1) % 4].z - corners[(index + 1) % 4].x * corner.z) / 2, 0);

      expect(area).toBeGreaterThan(0);
    }
  });

  it("is the same footprint turned a whole circle further or back", () => {
    const a = footprintBounds(piece(0.5, 0.5, 1.2, 0.7, 30));
    const b = footprintBounds(piece(0.5, 0.5, 1.2, 0.7, 30 + 360));
    const c = footprintBounds(piece(0.5, 0.5, 1.2, 0.7, 30 - 360));

    for (const other of [b, c]) {
      expect(other.minX).toBeCloseTo(a.minX, 9);
      expect(other.maxZ).toBeCloseTo(a.maxZ, 9);
    }
  });
});

describe("overlap: whether two footprints are in each other", () => {
  it("says no for footprints that are apart", () => {
    expect(overlap(piece(0, 0, 2, 2), piece(3, 0, 2, 2))).toBeNull();
    expect(overlap(piece(0, 0, 2, 2), piece(0, 3, 2, 2))).toBeNull();
    expect(overlap(piece(0, 0, 2, 2), piece(1.8, 1.8, 2, 2, 45))).toBeNull();
  });

  it("says no for footprints that only touch: side by side is not an overlap", () => {
    expect(overlap(piece(0, 0, 2, 2), piece(2, 0, 2, 2))).toBeNull();
    expect(overlap(piece(0, 0, 2, 2), piece(0, 2, 2, 2))).toBeNull();
    expect(overlap(piece(0, 0, 2, 2), piece(2, 2, 2, 2))).toBeNull();
  });

  it("says how deep, and along which direction the shortest push apart goes, from the first towards the second", () => {
    const found = overlap(piece(0, 0, 2, 2), piece(1.5, 0.2, 2, 2));

    expect(found?.depth).toBeCloseTo(0.5, 9);
    expect(found?.x).toBeCloseTo(1, 9);
    expect(found?.z).toBeCloseTo(0, 9);
    const other = overlap(piece(0, 0, 2, 2), piece(0.2, -1.2, 2, 2));
    expect(other?.depth).toBeCloseTo(0.8, 9);
    expect(other?.x).toBeCloseTo(0, 9);
    expect(other?.z).toBeCloseTo(-1, 9);
  });

  it("gives the same depth the other way round, and the opposite direction", () => {
    const next = random(11);
    let compared = 0;
    for (let run = 0; run < 500; run++) {
      const [a, b] = [randomPiece(next), randomPiece(next)];
      const ab = overlap(a, b);
      const ba = overlap(b, a);
      expect(Boolean(ab), `${run}`).toBe(Boolean(ba));
      if (!ab || !ba) continue;
      compared++;
      expect(ba.depth).toBeCloseTo(ab.depth, 9);
      expect(ba.x).toBeCloseTo(-ab.x, 9);
      expect(ba.z).toBeCloseTo(-ab.z, 9);
    }
    expect(compared).toBeGreaterThan(50);
  });

  it("sees a piece inside another, and the same place twice, as an overlap", () => {
    expect(overlap(piece(0, 0, 4, 4), piece(0.1, 0.1, 1, 1))).not.toBeNull();
    expect(overlap(piece(1, 1, 2, 1), piece(1, 1, 2, 1))).not.toBeNull();
  });

  it("sees what turned footprints do: a long piece turned a quarter reaches the other way", () => {
    // A sofa 2 m wide and 0.9 m deep covers x from -1 to 1 and z from -0.45 to 0.45; turned a quarter, the other way round.
    const sofa = piece(0, 0, 2, 0.9);
    const turned = { ...sofa, rotation_deg: 90 };
    const stool = (x: number, z: number) => piece(x, z, 0.5, 0.5);

    expect(overlap(sofa, stool(0, 0.8))).toBeNull();
    expect(overlap(turned, stool(0, 0.8))).not.toBeNull();
    expect(overlap(sofa, stool(1.3, 0))).toBeNull();
    expect(overlap(turned, stool(1.3, 0))).toBeNull();
    expect(overlap(sofa, stool(0.9, 0))).not.toBeNull();
  });

  it("sees the shape of a turned footprint, not the box around it: the corners of a diamond are not all there is", () => {
    const flat = piece(0, 0, 2, 2);

    // A square turned 45 degrees is a diamond: its corners reach 1.41 out from the middle, its sides only 1.
    expect(overlap(flat, piece(2.3, 0, 2, 2, 45))).not.toBeNull();
    expect(overlap(flat, piece(2.5, 2.5, 2, 2, 45))).toBeNull();
    // The boxes around these two overlap by a hair, but the shapes do not touch.
    expect(overlap(flat, piece(1.7, 1.7, 1, 1, 45))).toBeNull();
    expect(overlap(flat, piece(1.3, 1.3, 1, 1, 45))).not.toBeNull();
  });

  it("counts footprints that are closer than the gap as overlapping, and ones that are as far apart as the gap as not", () => {
    const a = piece(0, 0, 2, 2);

    expect(overlap(a, piece(2.05, 0, 2, 2), 0)).toBeNull();
    expect(overlap(a, piece(2.05, 0, 2, 2), 0.1)?.depth).toBeCloseTo(0.05, 9);
    expect(overlap(a, piece(2.1, 0, 2, 2), 0.1)).toBeNull();
    expect(overlap(a, piece(2.2, 0, 2, 2), 0.1)).toBeNull();
  });

  it("is a real overlap exactly when the two have area in common, for any footprints", () => {
    const next = random(3);
    let overlapping = 0;
    for (let run = 0; run < 3000; run++) {
      const [a, b] = [randomPiece(next), randomPiece(next)];

      const found = overlap(a, b) !== null;
      expect(found, `${run}: ${JSON.stringify([a, b])}`).toBe(overlapArea(a, b) > 1e-9);
      if (found) overlapping++;
    }
    // Neither all nor none of them overlap, so the check above says something.
    expect(overlapping).toBeGreaterThan(500);
    expect(overlapping).toBeLessThan(2500);
  });

  it("says how to get apart: moved that far along that direction, two footprints no longer overlap", () => {
    const next = random(5);
    let pushed = 0;
    for (let run = 0; run < 1000; run++) {
      const [a, b] = [randomPiece(next), randomPiece(next)];
      const found = overlap(a, b);
      if (!found) continue;
      pushed++;
      const shift = found.depth + 1e-6;

      const apart = overlap({ ...a, x_m: a.x_m - (found.x * shift) / 2, z_m: a.z_m - (found.z * shift) / 2 }, { ...b, x_m: b.x_m + (found.x * shift) / 2, z_m: b.z_m + (found.z * shift) / 2 });
      expect(apart, `${run}`).toBeNull();
      // And that is the shortest way: a little less is not enough.
      const less = found.depth * 0.9;
      expect(overlap({ ...a, x_m: a.x_m - (found.x * less) / 2, z_m: a.z_m - (found.z * less) / 2 }, { ...b, x_m: b.x_m + (found.x * less) / 2, z_m: b.z_m + (found.z * less) / 2 }), `${run}`).not.toBeNull();
    }
    expect(pushed).toBeGreaterThan(200);
  });
});

describe("overlapArea: how much two footprints have in common", () => {
  it("is 0 for footprints that are apart or touch", () => {
    expect(overlapArea(piece(0, 0, 2, 2), piece(5, 0, 2, 2))).toBe(0);
    expect(overlapArea(piece(0, 0, 2, 2), piece(2, 0, 2, 2))).toBeCloseTo(0, 12);
  });

  it("is the area of the part they share", () => {
    expect(overlapArea(piece(0, 0, 2, 2), piece(1, 1, 2, 2))).toBeCloseTo(1, 9);
    expect(overlapArea(piece(0, 0, 2, 2), piece(0.5, 0, 2, 2))).toBeCloseTo(3, 9);
    expect(overlapArea(piece(0, 0, 2, 2), piece(0, 0, 2, 2))).toBeCloseTo(4, 9);
  });

  it("is the whole of the smaller one when it is inside the bigger one", () => {
    expect(overlapArea(piece(0, 0, 6, 6), piece(0.5, -0.5, 2, 1))).toBeCloseTo(2, 9);
    expect(overlapArea(piece(0.5, -0.5, 2, 1), piece(0, 0, 6, 6))).toBeCloseTo(2, 9);
  });

  it("is the same for turned footprints: two bars crossing share a square, and a diamond in a square keeps its area", () => {
    expect(overlapArea(piece(0, 0, 2, 0.5), piece(0, 0, 2, 0.5, 90))).toBeCloseTo(0.25, 9);
    expect(overlapArea(piece(0, 0, 4, 4), piece(0, 0, 2, 2, 45))).toBeCloseTo(4, 9);
    // Two squares of 2 x 2 on the same middle, one of them turned 45 degrees, share a regular octagon that is 1 from the middle to each side.
    expect(overlapArea(piece(0, 0, 2, 2), piece(0, 0, 2, 2, 45))).toBeCloseTo(8 * (Math.SQRT2 - 1), 9);
  });

  it("is never more than the smaller of the two, and the same whichever is first", () => {
    const next = random(13);
    for (let run = 0; run < 500; run++) {
      const [a, b] = [randomPiece(next), randomPiece(next)];
      const area = overlapArea(a, b);

      expect(area).toBeCloseTo(overlapArea(b, a), 9);
      expect(area).toBeLessThanOrEqual(Math.min(a.width_m * a.depth_m, b.width_m * b.depth_m) + 1e-9);
      expect(area).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("footprintBounds and outsideRoom: whether a piece is in the room", () => {
  const room = { width_m: 4, length_m: 3 };

  it("gives the box around a turned footprint", () => {
    const { minX, maxX, minZ, maxZ } = footprintBounds(piece(1, -1, 2, 2, 45));

    expect(minX).toBeCloseTo(1 - Math.SQRT2, 9);
    expect(maxX).toBeCloseTo(1 + Math.SQRT2, 9);
    expect(minZ).toBeCloseTo(-1 - Math.SQRT2, 9);
    expect(maxZ).toBeCloseTo(-1 + Math.SQRT2, 9);
  });

  it("is 0 for a piece inside the room, also one that touches a wall", () => {
    expect(outsideRoom(piece(0, 0, 2, 1), room)).toBe(0);
    expect(outsideRoom(piece(1, 1, 2, 1), room)).toBe(0);
    expect(outsideRoom(piece(-1, -1, 2, 1), room)).toBe(0);
  });

  it("says how far a piece sticks out, through whichever wall", () => {
    expect(outsideRoom(piece(-1.2, 0, 2, 1), room)).toBeCloseTo(0.2, 9);
    expect(outsideRoom(piece(1.3, 0, 2, 1), room)).toBeCloseTo(0.3, 9);
    expect(outsideRoom(piece(0, -1.1, 2, 1), room)).toBeCloseTo(0.1, 9);
    expect(outsideRoom(piece(0, 1.25, 2, 1), room)).toBeCloseTo(0.25, 9);
    expect(outsideRoom(piece(5, 0, 2, 1), room)).toBeCloseTo(4, 9);
  });

  it("uses the turned footprint: a piece against a wall is too long once it is turned", () => {
    expect(outsideRoom(piece(0, 0, 3.5, 0.5, 0), room)).toBe(0);
    expect(outsideRoom(piece(0, 0, 3.5, 0.5, 90), room)).toBeCloseTo(0.25, 9);
    expect(outsideRoom(piece(0, 1, 2, 2, 45), room)).toBeCloseTo(Math.SQRT2 + 1 - 1.5, 9);
  });

  it("counts the walls as a gap further in, on every side", () => {
    expect(outsideRoom(piece(-1.5, 0, 1, 1), room, 0)).toBe(0);
    // The room is 4 wide and 3 long, so these pieces touch the left, right, back and front walls.
    expect(outsideRoom(piece(-1.5, 0, 1, 1), room, 0.05)).toBeCloseTo(0.05, 9);
    expect(outsideRoom(piece(1.5, 0, 1, 1), room, 0.05)).toBeCloseTo(0.05, 9);
    expect(outsideRoom(piece(0, -1, 1, 1), room, 0.05)).toBeCloseTo(0.05, 9);
    expect(outsideRoom(piece(0, 1, 1, 1), room, 0.05)).toBeCloseTo(0.05, 9);
    expect(outsideRoom(piece(0, 0, 1, 1), room, 0.05)).toBe(0);
  });
});
