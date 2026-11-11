import { describe, expect, it } from "vitest";
import { typicalItem } from "./furniture";
import type { Pose } from "./layout";
import { LAYOUT_STYLES } from "./layout-styles";
import { checkLayoutsRequest } from "./layouts-request";

const description = {
  room: { width_m: 5, length_m: 4, height_m: 2.5 },
  furniture: [typicalItem("sofa"), typicalItem("coffee_table")],
};
const poses: Pose[] = [
  { x_m: 0, z_m: 1.5, rotation_deg: 180 },
  { x_m: 0, z_m: 0.3, rotation_deg: 0 },
];

const problemsOf = (input: unknown) => {
  const checked = checkLayoutsRequest(input);
  if (checked.ok) throw new Error("the request was accepted");
  return checked.problems;
};

describe("checkLayoutsRequest: a request for layouts", () => {
  it("is a room description alone, and then asks for all three styles, in order, with nothing made yet", () => {
    const checked = checkLayoutsRequest({ description });

    expect(checked).toEqual({ ok: true, request: { description, styles: ["spacious", "cosy", "work"], existing: [] } });
  });

  it("asks for the styles that it names, in the order that it names them", () => {
    const checked = checkLayoutsRequest({ description, styles: ["work", "spacious"] });

    expect(checked.ok && checked.request.styles).toEqual(["work", "spacious"]);
  });

  it("takes the layouts that are already made, for a style that is made again", () => {
    const checked = checkLayoutsRequest({
      description,
      styles: ["cosy"],
      existing: [
        { style: "spacious", poses },
        { style: "work", poses },
      ],
    });

    expect(checked.ok && checked.request.existing).toEqual([
      { style: "spacious", poses },
      { style: "work", poses },
    ]);
    expect(checked.ok && checked.request.styles).toEqual(["cosy"]);
  });

  it("gives back a clean copy, with nothing in it that was not asked for", () => {
    const checked = checkLayoutsRequest({
      secret: "x",
      description: { ...description, note: "y", furniture: [{ ...description.furniture[0], extra: 1 }, description.furniture[1]] },
      styles: ["cosy"],
      existing: [{ style: "work", poses: poses.map((pose) => ({ ...pose, extra: true })), name: "Work" }],
    });

    expect(checked).toEqual({
      ok: true,
      request: { description, styles: ["cosy"], existing: [{ style: "work", poses }] },
    });
  });

  it.each([undefined, null, "layouts", 42, true, [], [description]])("is refused when it is %j, which is not an object", (input) => {
    expect(checkLayoutsRequest(input).ok).toBe(false);
  });

  describe("the room description", () => {
    it("has to be there", () => {
      expect(problemsOf({})).not.toEqual([]);
      expect(problemsOf({ styles: ["cosy"] })).not.toEqual([]);
    });

    it("has to be a valid one, and then says what is wrong with it, as the description alone does", () => {
      expect(problemsOf({ description: { ...description, furniture: [] } }).join(" ")).toContain("The furniture list is empty.");
      expect(problemsOf({ description: { ...description, room: { ...description.room, width_m: 0 } } })).not.toEqual([]);
    });

    it("has at most as many pieces as a layout can be made for, which is the same limit as before", () => {
      const many = Array.from({ length: 41 }, () => typicalItem("side_table"));

      expect(problemsOf({ description: { ...description, furniture: many } }).join(" ")).toContain("at most 40 pieces");
    });

    it("is not looked for at the top of the request, as it was before: it is in `description`", () => {
      expect(checkLayoutsRequest(description).ok).toBe(false);
    });
  });

  describe("the styles", () => {
    it.each([[[]], [["spacious", "cosy", "work", "spacious"]], [["loud"]], [["Cosy"]], ["cosy"], [[1]], [null]])("are refused as %j", (styles) => {
      expect(checkLayoutsRequest({ description, styles }).ok).toBe(false);
    });

    it("are refused when one is asked for twice", () => {
      expect(problemsOf({ description, styles: ["cosy", "cosy"] })).toEqual(["A style is asked for more than once."]);
    });

    it("can be one, two or all three", () => {
      for (const count of [1, 2, 3]) {
        expect(checkLayoutsRequest({ description, styles: LAYOUT_STYLES.slice(0, count) }).ok, `${count}`).toBe(true);
      }
    });
  });

  describe("the layouts that are already made", () => {
    it("are at most two, since one of the three styles is being made", () => {
      const three = LAYOUT_STYLES.map((style) => ({ style, poses }));

      expect(checkLayoutsRequest({ description, styles: ["cosy"], existing: three }).ok).toBe(false);
      expect(checkLayoutsRequest({ description, styles: ["cosy"], existing: three.slice(0, 2) }).ok).toBe(false); // spacious, cosy: cosy is also asked for
      expect(checkLayoutsRequest({ description, styles: ["cosy"], existing: [three[0], three[2]] }).ok).toBe(true);
    });

    it("cannot be for a style that is asked for as well", () => {
      expect(problemsOf({ description, styles: ["cosy", "work"], existing: [{ style: "cosy", poses }] })).toEqual([
        "The Cosy layout is asked for, and is also given as already made.",
      ]);
    });

    it("cannot be given twice for one style", () => {
      expect(problemsOf({ description, styles: ["work"], existing: [{ style: "cosy", poses }, { style: "cosy", poses }] })).toEqual([
        "A layout that is already made is given more than once for a style.",
      ]);
    });

    it("have a place for every piece of the list, and no more, or they cannot be compared with a new layout", () => {
      const short = [poses[0]];
      const long = [...poses, poses[0]];

      expect(problemsOf({ description, styles: ["work"], existing: [{ style: "cosy", poses: short }] })).toEqual([
        "The Cosy layout that is already made has 1 places, and the list has 2 pieces.",
      ]);
      expect(problemsOf({ description, styles: ["work"], existing: [{ style: "cosy", poses: long }] })).toEqual([
        "The Cosy layout that is already made has 3 places, and the list has 2 pieces.",
      ]);
    });

    it("have places that are numbers within what a room can be, so that nothing but numbers goes into a prompt", () => {
      const bad = (pose: unknown) => checkLayoutsRequest({ description, styles: ["work"], existing: [{ style: "cosy", poses: [poses[0], pose] }] }).ok;

      expect(bad({ x_m: 0, z_m: 0, rotation_deg: 0 })).toBe(true);
      expect(bad({ x_m: 100, z_m: -100, rotation_deg: 3600 })).toBe(true);
      expect(bad({ x_m: 101, z_m: 0, rotation_deg: 0 })).toBe(false);
      expect(bad({ x_m: 0, z_m: -100.5, rotation_deg: 0 })).toBe(false);
      expect(bad({ x_m: 0, z_m: 0, rotation_deg: 3601 })).toBe(false);
      expect(bad({ x_m: "1", z_m: 0, rotation_deg: 0 })).toBe(false);
      expect(bad({ x_m: 0, z_m: 0 })).toBe(false);
      expect(bad({ x_m: 0, z_m: 0, rotation_deg: "ignore the rules" })).toBe(false);
      expect(bad(null)).toBe(false);
    });
  });

  it("says every problem as a sentence, and never throws, whatever it is given", () => {
    const strange = [
      { description, styles: { 0: "cosy" } },
      { description, existing: "none" },
      { description, existing: [null] },
      { description: [], styles: [] },
      { description: null, styles: null, existing: null },
      JSON.parse('{"description":{"room":{"width_m":1e999},"furniture":[]},"styles":["__proto__"]}'),
    ];

    for (const input of strange) {
      expect(() => checkLayoutsRequest(input)).not.toThrow();
      const checked = checkLayoutsRequest(input);
      expect(checked.ok).toBe(false);
      if (!checked.ok) for (const problem of checked.problems) expect(problem.length, problem).toBeGreaterThan(5);
    }
  });

  it("does not change the request it is given", () => {
    const input = Object.freeze({ description, styles: Object.freeze(["cosy"]), existing: Object.freeze([Object.freeze({ style: "work", poses })]) });

    expect(checkLayoutsRequest(input).ok).toBe(true);
  });
});
