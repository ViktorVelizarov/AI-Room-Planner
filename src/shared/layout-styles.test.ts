import { describe, expect, it } from "vitest";
import type { Pose } from "./layout";
import {
  LAYOUT_STYLES,
  MIN_MOVE_M,
  STYLE_IDEAS,
  STYLE_NAMES,
  isDifferentEnough,
  isDifferentPlace,
  isLayoutStyle,
  piecesInOwnPlaces,
  piecesNeededInOwnPlaces,
} from "./layout-styles";

const at = (x_m: number, z_m: number, rotation_deg = 0): Pose => ({ x_m, z_m, rotation_deg });

describe("the styles", () => {
  it("are three, in the order they are shown: spacious, cosy, work-focused (AC1)", () => {
    expect([...LAYOUT_STYLES]).toEqual(["spacious", "cosy", "work"]);
    expect(LAYOUT_STYLES.map((style) => STYLE_NAMES[style])).toEqual(["Spacious", "Cosy", "Work-focused"]);
  });

  it("each have a name and an idea of their own, in one or two sentences, so that a layout always has something to say for itself (AC2)", () => {
    expect(new Set(LAYOUT_STYLES.map((style) => STYLE_NAMES[style])).size).toBe(3);
    expect(new Set(LAYOUT_STYLES.map((style) => STYLE_IDEAS[style])).size).toBe(3);
    for (const style of LAYOUT_STYLES) {
      const sentences = STYLE_IDEAS[style].split(/(?<=[.!?])\s+/);
      expect(sentences.length, style).toBeLessThanOrEqual(2);
      expect(STYLE_IDEAS[style].length, style).toBeGreaterThan(30);
      expect(STYLE_IDEAS[style].endsWith("."), style).toBe(true);
    }
  });

  it("are told from other things by isLayoutStyle, whatever the type", () => {
    for (const style of LAYOUT_STYLES) expect(isLayoutStyle(style)).toBe(true);
    for (const other of ["Spacious", "work-focused", "", "toString", "constructor", "__proto__", 0, null, undefined, {}, ["cosy"]]) {
      expect(isLayoutStyle(other), String(other)).toBe(false);
    }
  });
});

describe("isDifferentPlace: a piece that is in a different place in two layouts (AC3)", () => {
  it("is one whose middle is at least 50 cm from where it is in the other", () => {
    expect(MIN_MOVE_M).toBe(0.5);
    expect(isDifferentPlace(at(0, 0), at(0.5, 0))).toBe(true);
    expect(isDifferentPlace(at(0, 0), at(0, -0.5))).toBe(true);
    expect(isDifferentPlace(at(0, 0), at(2, 3))).toBe(true);
  });

  it("is not one that moved less than that, in any direction", () => {
    expect(isDifferentPlace(at(0, 0), at(0.49, 0))).toBe(false);
    expect(isDifferentPlace(at(0, 0), at(0, 0.49))).toBe(false);
    expect(isDifferentPlace(at(1, 1), at(1, 1))).toBe(false);
    // 0.34 m across and 0.34 m along is 0.48 m: less than 50 cm, although neither step is small.
    expect(isDifferentPlace(at(0, 0), at(0.34, 0.34))).toBe(false);
  });

  it("counts a move along a diagonal by its length, not by its steps", () => {
    // 0.36 m and 0.36 m is 0.509 m.
    expect(isDifferentPlace(at(0, 0), at(0.36, 0.36))).toBe(true);
    expect(isDifferentPlace(at(0, 0), at(-0.36, 0.36))).toBe(true);
  });

  it("does not count a piece that only turned where it stands", () => {
    expect(isDifferentPlace(at(1, 1, 0), at(1, 1, 180))).toBe(false);
    expect(isDifferentPlace(at(1, 1, 90), at(1, 1, 270))).toBe(false);
  });

  it("does not let the rounding of a place decide: a move of exactly 50 cm counts, even when it comes out a hair short", () => {
    expect(isDifferentPlace(at(0.1, 0.2), at(0.6, 0.2))).toBe(true);
    expect(isDifferentPlace(at(0, 0), at(0.5 - 1e-12, 0))).toBe(true);
    expect(isDifferentPlace(at(0, 0), at(0.5 - 1e-6, 0))).toBe(false);
  });

  it("is the same whichever of the two layouts is looked at first", () => {
    expect(isDifferentPlace(at(0, 0), at(0.6, 0))).toBe(isDifferentPlace(at(0.6, 0), at(0, 0)));
    expect(isDifferentPlace(at(0, 0), at(0.4, 0))).toBe(isDifferentPlace(at(0.4, 0), at(0, 0)));
  });
});

describe("piecesNeededInOwnPlaces: at least half of the pieces", () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [6, 3],
    [15, 8],
  ])("%i pieces need %i", (count, needed) => {
    expect(piecesNeededInOwnPlaces(count)).toBe(needed);
  });
});

describe("piecesInOwnPlaces: the pieces that are in a different place than in every other layout", () => {
  const mine = [at(0, 0), at(1, 1), at(2, 2), at(3, 3)];

  it("are those that are 50 cm or more from where they are in each of the others, by their places in the list", () => {
    const other = [at(0, 0), at(1, 2), at(2, 2), at(4, 3)];

    expect(piecesInOwnPlaces(mine, [other])).toEqual([1, 3]);
  });

  it("leave out a piece that is in the same place as in only one of the others: it has to differ from both", () => {
    const first = [at(5, 5), at(5, 5), at(5, 5), at(5, 5)];
    // The piece 2 is where it is in the second layout, and the piece 3 where it is in the first.
    const second = [at(-5, -5), at(-5, -5), at(2.1, 2), at(-5, -5)];
    const third = [at(-4, 4), at(-4, 4), at(-4, 4), at(3, 3.2)];

    expect(piecesInOwnPlaces(mine, [first, second])).toEqual([0, 1, 3]);
    expect(piecesInOwnPlaces(mine, [first, second, third])).toEqual([0, 1]);
  });

  it("are all of them when there is nothing to compare with", () => {
    expect(piecesInOwnPlaces(mine, [])).toEqual([0, 1, 2, 3]);
  });

  it("are none when a layout is the same as another", () => {
    expect(piecesInOwnPlaces(mine, [mine])).toEqual([]);
    expect(piecesInOwnPlaces(mine, [[at(9, 9), at(9, 9), at(9, 9), at(9, 9)], mine])).toEqual([]);
  });

  it("do not count a piece that was only turned", () => {
    const turned = mine.map((pose) => ({ ...pose, rotation_deg: 180 }));

    expect(piecesInOwnPlaces(mine, [turned])).toEqual([]);
  });

  it("has an empty answer for an empty list", () => {
    expect(piecesInOwnPlaces([], [[]])).toEqual([]);
  });

  it("does not change what it is given", () => {
    const frozen = Object.freeze(mine.map((pose) => Object.freeze({ ...pose })));
    const others = Object.freeze([Object.freeze(mine.map((pose) => Object.freeze({ ...pose, x_m: pose.x_m + 1 })))]);

    expect(() => piecesInOwnPlaces(frozen, others)).not.toThrow();
  });
});

describe("isDifferentEnough: a layout that is clearly different from the others (AC3)", () => {
  const base = [at(0, 0), at(1, 0), at(2, 0), at(3, 0)];
  /** `moved` pieces of the base are 1 m away, the others are where they were. */
  const withMoved = (moved: number) => base.map((pose, index) => (index < moved ? at(pose.x_m, pose.z_m + 1) : pose));

  it("is one in which exactly half of the pieces are in a different place", () => {
    expect(isDifferentEnough(withMoved(2), [base])).toBe(true);
  });

  it("is not one in which fewer than half are", () => {
    expect(isDifferentEnough(withMoved(1), [base])).toBe(false);
    expect(isDifferentEnough(withMoved(0), [base])).toBe(false);
  });

  it("is one in which more than half are", () => {
    expect(isDifferentEnough(withMoved(3), [base])).toBe(true);
    expect(isDifferentEnough(withMoved(4), [base])).toBe(true);
  });

  it("needs more than half of an odd number of pieces: 2 of 3, and not 1 of 3", () => {
    const three = base.slice(0, 3);

    expect(isDifferentEnough(three.map((pose, index) => (index < 2 ? at(pose.x_m, 1) : pose)), [three])).toBe(true);
    expect(isDifferentEnough(three.map((pose, index) => (index < 1 ? at(pose.x_m, 1) : pose)), [three])).toBe(false);
  });

  it("must be so from each of the others, not from one of them: a layout like the third is not clearly different", () => {
    const second = withMoved(4);
    const third = withMoved(1);

    // From the second it differs in every piece, from the base (the third here) in only one of the four.
    expect(isDifferentEnough(base, [second])).toBe(true);
    expect(isDifferentEnough(withMoved(1), [second, base])).toBe(false);
    expect(isDifferentEnough(third, [second])).toBe(true);
  });

  it("counts a piece for a layout only when it differs from all the others, so two layouts that each differ in half but in other pieces are not enough", () => {
    const first = [at(0, 0), at(1, 0), at(2, 0), at(3, 0)];
    const second = [at(0, 5), at(1, 5), at(2, 0), at(3, 0)];
    const third = [at(0, 0), at(1, 0), at(2, 5), at(3, 5)];

    // The first differs from the second in pieces 0 and 1, and from the third in 2 and 3: from both in none.
    expect(isDifferentEnough(first, [second])).toBe(true);
    expect(isDifferentEnough(first, [third])).toBe(true);
    expect(isDifferentEnough(first, [second, third])).toBe(false);
  });

  it("is true when there is no other layout to compare with", () => {
    expect(isDifferentEnough(base, [])).toBe(true);
  });

  it("is not true of a layout that is the same as another", () => {
    expect(isDifferentEnough(base, [base])).toBe(false);
  });

  it("is true of a layout with nothing in it, since half of nothing is nothing", () => {
    expect(isDifferentEnough([], [[]])).toBe(true);
  });

  it("needs the one piece of a room with one piece to be in another place", () => {
    expect(isDifferentEnough([at(0, 0)], [[at(0.2, 0)]])).toBe(false);
    expect(isDifferentEnough([at(0, 0)], [[at(0.7, 0)]])).toBe(true);
  });
});
