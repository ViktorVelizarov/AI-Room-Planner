import { describe, expect, it } from "vitest";
import type { FurnitureItem } from "../shared/furniture";
import type { RoomSize } from "../shared/room";
import { PIECE_GAP_M, WALL_GAP_M, arrangeInRows, type Placement } from "./arrangement";

const piece = (width_cm: number, depth_cm: number): FurnitureItem => ({
  label: "sofa",
  width_cm,
  depth_cm,
  height_cm: 80,
  color: "grey",
  material: "fabric",
});

// 4 m wide, so the pieces can stand from x = -1.9 to x = 1.9; 5 m long, so the back is at z = -2.5.
const room: RoomSize = { width_m: 4, length_m: 5, height_m: 2.5 };

const near = (actual: Placement, expected: Placement) => {
  expect(actual.x_m).toBeCloseTo(expected.x_m, 9);
  expect(actual.z_m).toBeCloseTo(expected.z_m, 9);
};

describe("arrangeInRows", () => {
  it("puts the first piece in the back left corner, a gap from each wall", () => {
    // A sofa 2 m wide and 0.9 m deep: its left edge at -1.9, its back edge at -2.4.
    const [sofa] = arrangeInRows(room, [piece(200, 90)]);

    near(sofa, { x_m: -0.9, z_m: -1.95 });
  });

  it("puts the next piece beside it, a gap away, with the back edges in line", () => {
    const [sofa, table] = arrangeInRows(room, [piece(200, 90), piece(100, 60)]);

    // The table starts 0.15 m after the sofa ends (at x = 0.1), so its middle is at 0.1 + 0.15 + 0.5.
    near(table, { x_m: 0.75, z_m: -2.1 });
    expect(sofa.z_m - 0.9 / 2).toBeCloseTo(table.z_m - 0.6 / 2, 9);
    expect(table.z_m - 0.6 / 2).toBeCloseTo(-2.5 + WALL_GAP_M, 9);
  });

  it("starts a new row, in front of the one before, when a piece does not fit what is left of the row", () => {
    const places = arrangeInRows(room, [piece(200, 90), piece(100, 60), piece(160, 90)]);

    // The first row is 0.9 m deep, so the next one starts at -2.4 + 0.9 + 0.15 = -1.35, at the left again.
    near(places[2], { x_m: -1.1, z_m: -0.9 });
  });

  it("goes on in the new row from the left, beside the piece that started it", () => {
    const places = arrangeInRows(room, [piece(200, 90), piece(100, 60), piece(160, 90), piece(40, 40)]);

    // The third piece ends at x = -0.3, so the fourth starts at -0.15 and is 0.4 m wide.
    near(places[3], { x_m: 0.05, z_m: -1.35 + 0.2 });
  });

  it("makes a row as deep as its deepest piece", () => {
    const places = arrangeInRows(room, [piece(100, 50), piece(100, 120), piece(100, 70), piece(250, 60)]);

    // The first three share a row of 1.2 m (their widths and gaps are 3.3 m); the fourth, 2.5 m wide, has to start a new one.
    near(places[3], { x_m: -1.9 + 1.25, z_m: -2.4 + 1.2 + 0.15 + 0.3 });
  });

  it("gives a piece that is wider than the room a row of its own, in the middle", () => {
    const places = arrangeInRows(room, [piece(100, 50), piece(500, 80), piece(100, 50)]);

    // The first row is 0.5 m deep, so the wide piece's row starts at -2.4 + 0.5 + 0.15 = -1.75 and is 0.8 m deep.
    near(places[1], { x_m: 0, z_m: -1.75 + 0.4 });
    // Nothing shares its row: the next piece is in a new row at the left, 0.8 m + a gap further.
    near(places[2], { x_m: -1.9 + 0.5, z_m: -1.75 + 0.8 + 0.15 + 0.25 });
  });

  it("puts a first piece that is wider than the room in the middle of the back row, and the next one in a new row", () => {
    const places = arrangeInRows(room, [piece(500, 80), piece(100, 50)]);

    near(places[0], { x_m: 0, z_m: -2.4 + 0.4 });
    near(places[1], { x_m: -1.9 + 0.5, z_m: -2.4 + 0.8 + 0.15 + 0.25 });
  });

  it("keeps the order of the list, and gives one place to each piece", () => {
    const items = [piece(100, 50), piece(120, 60), piece(80, 40), piece(90, 90), piece(70, 70)];

    const places = arrangeInRows(room, items);

    expect(places).toHaveLength(items.length);
    // Within a row the pieces go from left to right in the order of the list.
    expect(places[1].x_m).toBeGreaterThan(places[0].x_m);
    expect(places[2].x_m).toBeGreaterThan(places[1].x_m);
  });

  it("has nothing to place for an empty list", () => {
    expect(arrangeInRows(room, [])).toEqual([]);
  });

  it("does not change the pieces it is given, and gives the same answer every time", () => {
    const items = Object.freeze([Object.freeze(piece(200, 90)), Object.freeze(piece(100, 60))]);

    expect(arrangeInRows(room, items)).toEqual(arrangeInRows(room, items));
  });

  it("goes on in rows past the front wall if the furniture does not fit the room, instead of squeezing it in", () => {
    const items = Array.from({ length: 8 }, () => piece(180, 150));

    const places = arrangeInRows(room, items);

    const frontEdge = Math.max(...places.map((place) => place.z_m + 0.75));
    expect(frontEdge).toBeGreaterThan(room.length_m / 2);
  });

  it("lines the pieces up in the same way in a room of any size", () => {
    const small = arrangeInRows({ width_m: 1, length_m: 1, height_m: 2 }, [piece(50, 40)]);
    const large = arrangeInRows({ width_m: 20, length_m: 20, height_m: 5 }, [piece(50, 40)]);

    near(small[0], { x_m: -0.5 + 0.1 + 0.25, z_m: -0.5 + 0.1 + 0.2 });
    near(large[0], { x_m: -10 + 0.1 + 0.25, z_m: -10 + 0.1 + 0.2 });
  });
});

describe("arrangeInRows: whatever the furniture and the room", () => {
  // A small random generator that gives the same numbers every run, so a failure can be repeated.
  const random = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it("never lets two pieces overlap or come closer than the gap, and keeps them inside the walls on the left, right and back", () => {
    const next = random(12345);
    const between = (min: number, max: number) => min + next() * (max - min);

    for (let round = 0; round < 300; round++) {
      const size: RoomSize = { width_m: between(2, 12), length_m: between(2, 12), height_m: 2.5 };
      const items = Array.from({ length: 1 + Math.floor(next() * 10) }, () =>
        // Every piece fits the width of the room, so that it can share it with the walls' gap.
        piece(between(20, Math.min(250, (size.width_m - 2 * WALL_GAP_M) * 100)), between(20, 150)),
      );

      const places = arrangeInRows(size, items);

      const boxes = items.map((item, i) => ({
        left: places[i].x_m - item.width_cm / 200,
        right: places[i].x_m + item.width_cm / 200,
        back: places[i].z_m - item.depth_cm / 200,
        front: places[i].z_m + item.depth_cm / 200,
      }));
      const where = `round ${round}: ${JSON.stringify(size)}`;
      boxes.forEach((box, i) => {
        expect(box.left, `${where}, piece ${i} left`).toBeGreaterThanOrEqual(-size.width_m / 2 + WALL_GAP_M - 1e-9);
        expect(box.right, `${where}, piece ${i} right`).toBeLessThanOrEqual(size.width_m / 2 - WALL_GAP_M + 1e-9);
        expect(box.back, `${where}, piece ${i} back`).toBeGreaterThanOrEqual(-size.length_m / 2 + WALL_GAP_M - 1e-9);
      });
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          const apartAcross = Math.max(boxes[a].left - boxes[b].right, boxes[b].left - boxes[a].right);
          const apartAlong = Math.max(boxes[a].back - boxes[b].front, boxes[b].back - boxes[a].front);
          expect(Math.max(apartAcross, apartAlong), `${where}, pieces ${a} and ${b}`).toBeGreaterThanOrEqual(PIECE_GAP_M - 1e-9);
        }
      }
    }
  });
});
