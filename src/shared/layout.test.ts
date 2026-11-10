import { describe, expect, it } from "vitest";
import { typicalItem, type FurnitureItem } from "./furniture";
import {
  CROWDED_FLOOR_COVERAGE,
  MAX_FLOOR_COVERAGE,
  MAX_LAYOUT_PIECES,
  checkLayoutRequest,
  crowdedWarning,
  describeFacing,
  describePiece,
  floorCoverage,
  footprintOf,
  isRug,
  layoutKey,
  normaliseRotation,
  piecesBiggerThanRoom,
  whyNoLayoutIsPossible,
} from "./layout";

const sofa: FurnitureItem = { ...typicalItem("sofa"), width_cm: 200, depth_cm: 90 };
const table: FurnitureItem = { ...typicalItem("coffee_table"), width_cm: 100, depth_cm: 60 };
const rug: FurnitureItem = { ...typicalItem("rug"), width_cm: 160, depth_cm: 230 };
const room = { width_m: 5, length_m: 4, height_m: 2.5 };
// A floor of 10 m2, and a piece that covers `percent` of it: 4 m across, and 2.5 cm deep for each percent.
const tenSquareMetres = { ...room, width_m: 4, length_m: 2.5 };
const covering = (percent: number): FurnitureItem => ({ ...table, width_cm: 400, depth_cm: percent * 2.5 });

describe("footprintOf: a piece of the list put where a pose says", () => {
  it("is the pose with the size in metres", () => {
    expect(footprintOf(sofa, { x_m: 1, z_m: -2, rotation_deg: 90 })).toEqual({ x_m: 1, z_m: -2, rotation_deg: 90, width_m: 2, depth_m: 0.9 });
  });
});

describe("isRug", () => {
  it("is true only for a rug", () => {
    expect(isRug(rug)).toBe(true);
    expect(isRug(sofa)).toBe(false);
  });
});

describe("normaliseRotation", () => {
  it.each([
    [0, 0],
    [90, 90],
    [360, 0],
    [450, 90],
    [-90, 270],
    [-450, 270],
    [719.5, 359.5],
  ])("turns %s degrees into %s", (given, expected) => {
    expect(normaliseRotation(given)).toBeCloseTo(expected, 9);
  });
});

describe("describePiece", () => {
  it("says the type and the place in the list, counting from 1 as the page does", () => {
    expect(describePiece("sofa", 0)).toBe("Sofa (item 1)");
    expect(describePiece("tv_stand", 4)).toBe("TV stand (item 5)");
  });
});

describe("floorCoverage: how much of the floor the pieces cover", () => {
  it("is the area of the footprints as a part of the area of the floor", () => {
    // 1.8 m2 and 0.6 m2 on 20 m2.
    expect(floorCoverage({ room, furniture: [sofa, table] })).toBeCloseTo(0.12, 9);
  });

  it("does not count a rug, which other pieces stand on", () => {
    expect(floorCoverage({ room, furniture: [sofa, table, rug] })).toBeCloseTo(0.12, 9);
  });

  it("is 0 for a room with nothing but a rug in it, and more than 1 when the pieces cannot all fit", () => {
    expect(floorCoverage({ room, furniture: [rug] })).toBe(0);
    expect(floorCoverage({ room: { ...room, width_m: 1, length_m: 2 }, furniture: [sofa, sofa] })).toBeGreaterThan(1);
  });

  it("has the thresholds in the order that the notes say: a warning, and then no use asking", () => {
    expect(CROWDED_FLOOR_COVERAGE).toBeLessThan(MAX_FLOOR_COVERAGE);
    expect(MAX_FLOOR_COVERAGE).toBeLessThan(1);
  });
});

describe("piecesBiggerThanRoom: the pieces that cannot be in the room at all", () => {
  it("finds none when every piece fits", () => {
    expect(piecesBiggerThanRoom({ room, furniture: [sofa, table, rug] })).toEqual([]);
  });

  it("finds a piece that is longer than the room in both directions", () => {
    const narrow = { ...room, width_m: 1.5, length_m: 1.8 };

    expect(piecesBiggerThanRoom({ room: narrow, furniture: [table, sofa, rug] })).toEqual([1, 2]);
  });

  it("lets a piece that fits only when it is turned count as fitting", () => {
    // 2 m wide in a room 1.2 m wide and 3 m long: it fits turned a quarter.
    expect(piecesBiggerThanRoom({ room: { ...room, width_m: 1.2, length_m: 3 }, furniture: [{ ...sofa, depth_cm: 100 }] })).toEqual([]);
  });

  it("lets a piece that is exactly as big as the room count as fitting", () => {
    expect(piecesBiggerThanRoom({ room: { ...room, width_m: 2, length_m: 0.9 }, furniture: [sofa] })).toEqual([]);
  });
});

describe("layoutKey: which descriptions can share a layout", () => {
  const description = { room, furniture: [sofa, table] };

  it("is the same when only the colours, the materials and the heights are not", () => {
    const repainted = {
      room: { ...room, height_m: 3.2 },
      furniture: [
        { ...sofa, color: "red", material: "leather" as const, height_cm: 70 },
        { ...table, color: "white", height_cm: 30 },
      ],
    };

    expect(layoutKey(repainted)).toBe(layoutKey(description));
  });

  it.each([
    ["the width of the room", { ...description, room: { ...room, width_m: 5.5 } }],
    ["the length of the room", { ...description, room: { ...room, length_m: 4.5 } }],
    ["the type of a piece", { ...description, furniture: [sofa, { ...table, label: "side_table" as const }] }],
    ["the width of a piece", { ...description, furniture: [sofa, { ...table, width_cm: 110 }] }],
    ["the depth of a piece", { ...description, furniture: [sofa, { ...table, depth_cm: 70 }] }],
    ["the order of the pieces", { ...description, furniture: [table, sofa] }],
    ["a piece more", { ...description, furniture: [sofa, table, rug] }],
    ["a piece less", { ...description, furniture: [sofa] }],
  ])("is not the same when %s is not", (_name, other) => {
    expect(layoutKey(other)).not.toBe(layoutKey(description));
  });

  it("does not mix up the width and the depth of a piece, or the width and the length of the room", () => {
    expect(layoutKey({ room, furniture: [{ ...sofa, width_cm: 90, depth_cm: 200 }] })).not.toBe(layoutKey({ room, furniture: [sofa] }));
    expect(layoutKey({ room: { ...room, width_m: 4, length_m: 5 }, furniture: [sofa] })).not.toBe(layoutKey({ room: { ...room, width_m: 5, length_m: 4 }, furniture: [sofa] }));
  });
});

describe("checkLayoutRequest: what the layout generator is given", () => {
  it("accepts a room description", () => {
    const result = checkLayoutRequest({ room, furniture: [sofa, table] });

    expect(result).toEqual({ ok: true, description: { room, furniture: [sofa, table] } });
  });

  it("says what is wrong with one that is not valid, in sentences", () => {
    const result = checkLayoutRequest({ room, furniture: [{ ...sofa, width_cm: 0 }] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/Furniture item 1 \(Sofa\)/);
  });

  it.each([undefined, null, 5, "room", [], {}])("does not fail on %j", (input) => {
    expect(checkLayoutRequest(input).ok).toBe(false);
  });

  it("accepts as many pieces as a layout is made for, and not one more", () => {
    const many = (count: number) => ({ room, furniture: Array.from({ length: count }, () => table) });

    expect(checkLayoutRequest(many(MAX_LAYOUT_PIECES)).ok).toBe(true);
    const tooMany = checkLayoutRequest(many(MAX_LAYOUT_PIECES + 1));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.problems).toEqual([`A layout can be made for at most ${MAX_LAYOUT_PIECES} pieces of furniture, and the list has ${MAX_LAYOUT_PIECES + 1}.`]);
  });
});

describe("describeFacing: which way a piece faces, in words", () => {
  it.each([
    [0, "the front wall"],
    [90, "the right wall"],
    [180, "the back wall"],
    [270, "the left wall"],
    [360, "the front wall"],
    [-90, "the left wall"],
    [450, "the right wall"],
  ])("says that %s degrees is %s", (degrees, words) => {
    expect(describeFacing(degrees)).toBe(words);
  });

  it("allows a few degrees either way, as nobody measures a turn that closely", () => {
    expect(describeFacing(93)).toBe("the right wall");
    expect(describeFacing(-4)).toBe("the front wall");
    expect(describeFacing(185)).toBe("the back wall");
  });

  it("says between which two walls a piece that is angled faces", () => {
    expect(describeFacing(45)).toBe("between the front wall and the right wall");
    expect(describeFacing(135)).toBe("between the right wall and the back wall");
    expect(describeFacing(225)).toBe("between the back wall and the left wall");
    expect(describeFacing(315)).toBe("between the left wall and the front wall");
    expect(describeFacing(96)).toBe("between the right wall and the back wall");
  });
});

describe("whyNoLayoutIsPossible: when there is no use asking for a layout", () => {
  it("says nothing for a room that can hold its furniture", () => {
    expect(whyNoLayoutIsPossible({ room, furniture: [sofa, table, rug] })).toBeNull();
  });

  it("names the pieces that are bigger than the room, by type and place in the list", () => {
    const narrow = { ...room, width_m: 1.5, length_m: 1.8 };

    expect(whyNoLayoutIsPossible({ room: narrow, furniture: [table, sofa] })).toBe("Sofa (item 2) is bigger than the room, so no layout is possible. Check the size of the room and the size of the piece.");
    expect(whyNoLayoutIsPossible({ room: narrow, furniture: [rug, sofa] })).toMatch(/^Rug \(item 1\), Sofa \(item 2\) are bigger than the room/);
  });

  it("says that the room is too full when the pieces cover more of the floor than the most there can be", () => {
    // Six sofas of 1.8 m2 on 12 m2: 90%.
    const message = whyNoLayoutIsPossible({ room: { ...room, width_m: 4, length_m: 3 }, furniture: Array.from({ length: 6 }, () => sofa) });

    expect(message).toBe("Your furniture would cover 90% of the floor, which leaves no room for a layout without overlaps. Check the size of the room, or take some furniture out of the list.");
  });

  it("lets a room that is exactly as full as the most there can be go on, and stops one that is fuller", () => {
    // 4 m x 2.5 m = 10 m2, and 7 m2 is 70%: tables of 1.4 m x 0.5 m cover 0.7 m2 each, so 10 of them are exactly the most, and 11 are more.
    const long = { ...table, width_cm: 140, depth_cm: 50 };
    const small = { ...room, width_m: 4, length_m: 2.5 };

    expect(whyNoLayoutIsPossible({ room: small, furniture: Array.from({ length: 10 }, () => long) })).toBeNull();
    expect(whyNoLayoutIsPossible({ room: small, furniture: Array.from({ length: 11 }, () => long) })).toMatch(/^Your furniture would cover 77% of the floor/);
  });

  it("stops a room that is only a little fuller than the most there can be", () => {
    expect(whyNoLayoutIsPossible({ room: tenSquareMetres, furniture: [covering(69.7)] })).toBeNull();
    expect(whyNoLayoutIsPossible({ room: tenSquareMetres, furniture: [covering(70.3)] })).toMatch(/^Your furniture would cover 70% of the floor/);
  });

  it("rounds the percentage that it says, and does not cut it off", () => {
    expect(whyNoLayoutIsPossible({ room: tenSquareMetres, furniture: [covering(74.6)] })).toMatch(/^Your furniture would cover 75% of the floor/);
    expect(whyNoLayoutIsPossible({ room: tenSquareMetres, furniture: [covering(74.4)] })).toMatch(/^Your furniture would cover 74% of the floor/);
  });
});

describe("crowdedWarning: when a layout may not be possible", () => {
  it("says nothing for a room with plenty of floor", () => {
    expect(crowdedWarning({ room, furniture: [sofa, table] })).toBeNull();
  });

  it("warns from 60% of the floor covered, with the number", () => {
    // 4 m x 2.5 m = 10 m2; 10 tables of 0.6 m2 cover 60%.
    const furniture = (count: number) => Array.from({ length: count }, () => table);
    const small = { ...room, width_m: 4, length_m: 2.5 };

    expect(crowdedWarning({ room: small, furniture: furniture(9) })).toBeNull();
    expect(crowdedWarning({ room: small, furniture: furniture(10) })).toBe("Your furniture covers about 60% of the floor, so a layout without overlaps may not be possible.");
  });

  it("leaves it to the other message when the room is too full for a layout at all", () => {
    const small = { ...room, width_m: 4, length_m: 2.5 };

    expect(crowdedWarning({ room: small, furniture: Array.from({ length: 12 }, () => table) })).toBeNull();
  });

  it("starts at 60% and not a little before it", () => {
    expect(crowdedWarning({ room: tenSquareMetres, furniture: [covering(55.5)] })).toBeNull();
    expect(crowdedWarning({ room: tenSquareMetres, furniture: [covering(59.7)] })).toBeNull();
    expect(crowdedWarning({ room: tenSquareMetres, furniture: [covering(60.3)] })).toMatch(/^Your furniture covers about 60% of the floor/);
  });

  it("goes on up to the most there can be, and leaves it to the other message from just over that", () => {
    expect(crowdedWarning({ room: tenSquareMetres, furniture: [covering(69.7)] })).toMatch(/^Your furniture covers about 70% of the floor/);
    expect(crowdedWarning({ room: tenSquareMetres, furniture: [covering(70)] })).toMatch(/^Your furniture covers about 70% of the floor/);
    expect(crowdedWarning({ room: tenSquareMetres, furniture: [covering(70.3)] })).toBeNull();
  });
});
