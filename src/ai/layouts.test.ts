import { describe, expect, it, vi } from "vitest";
import { typicalItem } from "../shared/furniture";
import type { Pose } from "../shared/layout";
import { LAYOUT_STYLES, STYLE_IDEAS, isDifferentEnough, type LayoutStyle } from "../shared/layout-styles";
import { AiTimeoutError } from "./gemini";
import { LayoutOverlapError, RoomTooFullError } from "./layout";
import { generateLayouts, type StyleOutcome } from "./layouts";
import type { GenerateLayoutFn, LayoutRequest, ModelAnswer } from "./types";

// Four small tables in a big room: they never overlap, wherever they are put along z, so what is tested
// is which layouts differ and how, and not the fixing of overlaps (which has its own tests).
const room = { width_m: 8, length_m: 6, height_m: 2.5 };
const table = { ...typicalItem("side_table"), width_cm: 45, depth_cm: 45 };
const description = { room, furniture: [table, table, table, table] };
const XS = [-3, -1, 1, 3];

/** The four tables along a line at the given distances from the middle of the room: one z for each. */
const along = (...zs: number[]): Pose[] => zs.map((z_m, index) => ({ x_m: XS[index], z_m, rotation_deg: 0 }));
const answerOf = (poses: Pose[], text?: string): ModelAnswer => ({
  text: JSON.stringify({ ...(text === undefined ? {} : { description: text }), pieces: poses.map((pose, index) => ({ index, label: "side_table", ...pose })) }),
  usage: { inputTokens: 10, outputTokens: 5 },
});

// Layouts that differ in the places of all four pieces from each other: 1.5 m apart.
const BACK = along(-1.5, -1.5, -1.5, -1.5);
const MIDDLE = along(0, 0, 0, 0);
const FRONT = along(1.5, 1.5, 1.5, 1.5);

type Script = ModelAnswer | Error;
/**
 * A model that answers what each style is scripted to, in order, one answer for each call it gets. It
 * records every request, and fails the test if it is asked for a style more often than it was told.
 */
function fakeModel(scripts: Partial<Record<LayoutStyle, Script[]>>) {
  const requests: LayoutRequest[] = [];
  const generate = vi.fn<GenerateLayoutFn>(async (request) => {
    requests.push(request);
    const next = scripts[request.style!]?.shift();
    if (!next) throw new Error(`Unexpected call for ${request.style}`);
    if (next instanceof Error) throw next;
    return next;
  });
  return { generate, requests, callsFor: (style: LayoutStyle) => requests.filter((request) => request.style === style) };
}

const okOf = (outcome: StyleOutcome) => {
  if (!outcome.ok) throw new Error(`${outcome.style} failed: ${JSON.stringify(outcome.failure)}`);
  return outcome;
};
const failureOf = (outcome: StyleOutcome) => {
  if (outcome.ok) throw new Error(`${outcome.style} was made`);
  return outcome.failure;
};
const allThree = async (model: ReturnType<typeof fakeModel>) => generateLayouts(description, LAYOUT_STYLES, model.generate);

describe("generateLayouts: a layout in each style (US-21 AC1)", () => {
  it("makes one layout for each style, in the order of the styles, each with the poses the model gave for it", async () => {
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(MIDDLE)], work: [answerOf(FRONT)] });

    const outcomes = await allThree(model);

    expect(outcomes.map((outcome) => outcome.style)).toEqual(["spacious", "cosy", "work"]);
    expect(outcomes.map((outcome) => okOf(outcome).poses)).toEqual([BACK, MIDDLE, FRONT]);
    expect(outcomes.map((outcome) => okOf(outcome).adjusted)).toEqual([[], [], []]);
    expect(model.generate).toHaveBeenCalledTimes(3);
  });

  it("is in the order that the styles were asked for, whichever order the models answer in", async () => {
    const answers = new Map<LayoutStyle, (answer: ModelAnswer) => void>();
    const generate: GenerateLayoutFn = (request) => new Promise((resolve) => answers.set(request.style!, resolve));

    const making = generateLayouts(description, ["work", "spacious", "cosy"], generate);
    await Promise.resolve();
    answers.get("cosy")!(answerOf(MIDDLE));
    answers.get("work")!(answerOf(FRONT));
    answers.get("spacious")!(answerOf(BACK));
    const outcomes = await making;

    expect(outcomes.map((outcome) => [outcome.style, okOf(outcome).poses[0].z_m])).toEqual([
      ["work", 1.5],
      ["spacious", -1.5],
      ["cosy", 0],
    ]);
  });

  it("asks for all the styles at the same time, and not one after another", async () => {
    const waiting: ((answer: ModelAnswer) => void)[] = [];
    const asked: LayoutStyle[] = [];
    const generate: GenerateLayoutFn = (request) =>
      new Promise((resolve) => {
        asked.push(request.style!);
        waiting.push(resolve);
      });

    const making = generateLayouts(description, LAYOUT_STYLES, generate);
    await Promise.resolve();

    // Every style has been asked for before any of them has answered.
    expect(asked).toEqual(["spacious", "cosy", "work"]);
    [BACK, MIDDLE, FRONT].forEach((poses, index) => waiting[index](answerOf(poses)));
    expect(await making).toHaveLength(3);
  });

  it("tells each model its style and the other styles that are made at the same time, which it cannot see, and nothing is shown as already made", async () => {
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(MIDDLE)], work: [answerOf(FRONT)] });

    await allThree(model);

    expect(model.callsFor("spacious")[0]).toMatchObject({ style: "spacious", alongside: ["cosy", "work"], avoid: [] });
    expect(model.callsFor("cosy")[0]).toMatchObject({ style: "cosy", alongside: ["spacious", "work"], avoid: [] });
    expect(model.callsFor("work")[0]).toMatchObject({ style: "work", alongside: ["spacious", "cosy"], avoid: [] });
    expect(model.requests.every((request) => request.description === description)).toBe(true);
  });

  it("can make fewer than three, and then has no layouts alongside it for one style", async () => {
    const model = fakeModel({ cosy: [answerOf(MIDDLE)] });

    const outcomes = await generateLayouts(description, ["cosy"], model.generate);

    expect(outcomes).toHaveLength(1);
    expect(okOf(outcomes[0]).poses).toEqual(MIDDLE);
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(model.requests[0]).toMatchObject({ style: "cosy", alongside: [], avoid: [] });
  });

  it("makes nothing for no styles, and asks nothing", async () => {
    const model = fakeModel({});

    expect(await generateLayouts(description, [], model.generate)).toEqual([]);
    expect(model.generate).not.toHaveBeenCalled();
  });
});

describe("generateLayouts: the description of each layout (US-21 AC2)", () => {
  it("is what the model said about the layout, in a sentence or two", async () => {
    const model = fakeModel({
      spacious: [answerOf(BACK, "Open and airy. Wide paths all round.")],
      cosy: [answerOf(MIDDLE, "Snug and sociable.")],
      work: [answerOf(FRONT, "The desk has the best place. The rest is kept apart.")],
    });

    const outcomes = await allThree(model);

    expect(outcomes.map((outcome) => okOf(outcome).description)).toEqual([
      "Open and airy. Wide paths all round.",
      "Snug and sociable.",
      "The desk has the best place. The rest is kept apart.",
    ]);
  });

  it("is the idea of the style when the answer has none that can be used, so that every layout has one", async () => {
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(MIDDLE, "")], work: [answerOf(FRONT, "x".repeat(400))] });

    const outcomes = await allThree(model);

    expect(outcomes.map((outcome) => okOf(outcome).description)).toEqual([STYLE_IDEAS.spacious, STYLE_IDEAS.cosy, STYLE_IDEAS.work]);
    // And it did not cost another call.
    expect(model.generate).toHaveBeenCalledTimes(3);
  });
});

describe("generateLayouts: whether the description of a layout is the model's", () => {
  it("says so when the model wrote one, so that the server can log the layouts that fell back on the idea of their style", async () => {
    const model = fakeModel({ spacious: [answerOf(BACK, "Open.")], cosy: [answerOf(MIDDLE)], work: [answerOf(FRONT, "")] });

    const outcomes = await allThree(model);

    expect(outcomes.map((outcome) => okOf(outcome).described)).toEqual([true, false, false]);
  });

  it("is true for a description that was cut to its first sentence, since the model wrote it", async () => {
    const long = `${"A".repeat(149)}. ${"B".repeat(150)}.`;
    const model = fakeModel({ cosy: [answerOf(MIDDLE, long)] });

    const [outcome] = await generateLayouts(description, ["cosy"], model.generate);

    expect(okOf(outcome).described).toBe(true);
    expect(okOf(outcome).description).toBe(`${"A".repeat(149)}.`);
  });
});

describe("generateLayouts: each style succeeds or fails on its own (US-21 AC4)", () => {
  it("lets the other two stand when one answer is not a layout twice, and says why that one is not", async () => {
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [{ text: "no" }, { text: "still no" }], work: [answerOf(FRONT)] });

    const outcomes = await allThree(model);

    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    const failure = failureOf(outcomes[1]);
    expect(failure).toMatchObject({ code: "invalid_answer" });
    expect(failure.code === "invalid_answer" && failure.reasons).toHaveLength(2);
    expect(failure.code === "invalid_answer" && failure.reasons[0]).toMatch(/not valid JSON/);
    // The failed style was asked twice, the others once each.
    expect(model.callsFor("cosy")).toHaveLength(2);
    expect(model.callsFor("spacious")).toHaveLength(1);
    expect(model.callsFor("work")).toHaveLength(1);
  });

  it("uses the second answer of a style whose first was not a layout, which is the retry of one style and does not hold up the others", async () => {
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [{ text: "no" }, answerOf(MIDDLE)], work: [answerOf(FRONT)] });

    const outcomes = await allThree(model);

    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true, true]);
    expect(okOf(outcomes[1]).poses).toEqual(MIDDLE);
    expect(model.callsFor("cosy")[1].feedback).toMatch(/not valid JSON/);
  });

  it("fails the style that cannot be made fine, and not the others", async () => {
    // Two long thin pieces that cross wherever they are put in a room of 1 m x 1 m: there is no layout of them without an overlap.
    const across = { ...typicalItem("bookshelf"), width_cm: 100, depth_cm: 10 };
    const upright = { ...typicalItem("bookshelf"), width_cm: 10, depth_cm: 100 };
    const crossing = { room: { width_m: 1, length_m: 1, height_m: 2.5 }, furniture: [across, upright] };
    const poses: Pose[] = [{ x_m: 0, z_m: 0, rotation_deg: 0 }, { x_m: 0, z_m: 0, rotation_deg: 0 }];
    const text = JSON.stringify({ pieces: poses.map((pose, index) => ({ index, label: "bookshelf", ...pose })) });
    const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue({ text });

    const outcomes = await generateLayouts(crossing, ["cosy"], generate);

    expect(failureOf(outcomes[0])).toMatchObject({ code: "layout_has_overlaps" });
    const failure = failureOf(outcomes[0]);
    expect(failure.code === "layout_has_overlaps" && failure.problems.length).toBeGreaterThan(0);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("says that the call itself failed, with the error as it was, for the style whose call failed, and does not ask that style again", async () => {
    const network = new Error("socket hang up");
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [network], work: [answerOf(FRONT)] });

    const outcomes = await allThree(model);

    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    const failure = failureOf(outcomes[1]);
    expect(failure.code).toBe("error");
    expect(failure.code === "error" && failure.error).toBe(network);
    expect(model.callsFor("cosy")).toHaveLength(1);
  });

  it("gives a call that ran out of time as the error that it was, so that it can be told from a service that is down", async () => {
    const late = new AiTimeoutError(120_000);
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [late], work: [answerOf(FRONT)] });

    const outcomes = await allThree(model);

    const failure = failureOf(outcomes[1]);
    expect(failure.code === "error" && failure.error).toBe(late);
    // It was not asked again: another call would take as long.
    expect(model.callsFor("cosy")).toHaveLength(1);
  });

  it("can fail every style, and then says so for each", async () => {
    const model = fakeModel({ spacious: [new Error("down")], cosy: [new Error("down")], work: [new Error("down")] });

    const outcomes = await allThree(model);

    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, false, false]);
    expect(outcomes.map((outcome) => failureOf(outcome).code)).toEqual(["error", "error", "error"]);
  });

  it("does not let a style that throws without being asked to catch it reject the whole answer", async () => {
    const generate: GenerateLayoutFn = async (request) => {
      if (request.style === "work") throw "not even an Error";
      return answerOf(request.style === "spacious" ? BACK : MIDDLE);
    };

    const outcomes = await generateLayouts(description, LAYOUT_STYLES, generate);

    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true, false]);
    const failure = failureOf(outcomes[2]);
    expect(failure.code === "error" && failure.error).toBe("not even an Error");
  });
});

describe("generateLayouts: a room that cannot hold the furniture", () => {
  it("is refused once, with the sentence for the user, and the model is not asked", async () => {
    const model = fakeModel({});
    const tooFull = { room: { width_m: 2, length_m: 2, height_m: 2.5 }, furniture: [{ ...typicalItem("bed"), width_cm: 180, depth_cm: 200 }] };

    await expect(generateLayouts(tooFull, LAYOUT_STYLES, model.generate)).rejects.toBeInstanceOf(RoomTooFullError);
    await expect(generateLayouts(tooFull, LAYOUT_STYLES, model.generate)).rejects.toThrow(/cover 90% of the floor/);
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("is also so for a piece that is bigger than the room, and is a RoomTooFullError and not a LayoutOverlapError, which is for layouts", async () => {
    const tooBig = { room: { width_m: 2, length_m: 2, height_m: 2.5 }, furniture: [{ ...typicalItem("bed"), width_cm: 140, depth_cm: 260 }] };
    const generate = vi.fn<GenerateLayoutFn>();

    const error = await generateLayouts(tooBig, ["cosy"], generate).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RoomTooFullError);
    expect(error).not.toBeInstanceOf(LayoutOverlapError);
    expect((error as Error).message).toMatch(/bigger than the room/);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("generateLayouts: layouts that are clearly different from each other (US-21 AC3)", () => {
  it("leaves three layouts alone that are different in every piece, and asks for nothing more", async () => {
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(MIDDLE)], work: [answerOf(FRONT)] });

    const outcomes = await allThree(model);

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(model.generate).toHaveBeenCalledTimes(3);
  });

  it("leaves three layouts alone in which each has exactly half of its pieces in places of its own", async () => {
    // Each pair has two pieces in the same place, and each piece is in a place of its own in two of the three.
    const A = along(-1.5, -1.5, 0, 0);
    const B = along(0, 0, 1.5, 1.5);
    const C = along(1.5, 1.5, -1.5, -1.5);
    const model = fakeModel({ spacious: [answerOf(A)], cosy: [answerOf(B)], work: [answerOf(C)] });

    const outcomes = await allThree(model);

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(model.generate).toHaveBeenCalledTimes(3);
  });

  describe("when one is too much like another", () => {
    // Piece 0 is the only one in a place of its own in the first two, which are the same in the other three.
    const SIMILAR_A = along(-1.5, -1.5, -1.5, -1.5);
    const SIMILAR_B = along(0, -1.5, -1.5, -1.5);

    it("makes the weakest once more, told where the other two put the pieces, and uses the new layout when it is different enough", async () => {
      const better = along(0, 1.5, 0, 1.5);
      const model = fakeModel({ spacious: [answerOf(SIMILAR_A)], cosy: [answerOf(SIMILAR_B), answerOf(better, "Closer now.")], work: [answerOf(FRONT)] });

      const outcomes = await allThree(model);

      expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
      expect(okOf(outcomes[1]).poses).toEqual(better);
      expect(okOf(outcomes[1]).description).toBe("Closer now.");
      // The two that were fine are as they were.
      expect(okOf(outcomes[0]).poses).toEqual(SIMILAR_A);
      expect(okOf(outcomes[2]).poses).toEqual(FRONT);
      expect(model.generate).toHaveBeenCalledTimes(4);
      // The three layouts that are used are different enough from each other.
      const poses = outcomes.map((outcome) => okOf(outcome).poses);
      poses.forEach((own, index) => expect(isDifferentEnough(own, poses.filter((_, other) => other !== index))).toBe(true));
    });

    it("tells the model of the second try which style it is, and shows it the layouts of the other two, by name, and no longer says they are made at the same time", async () => {
      const model = fakeModel({ spacious: [answerOf(SIMILAR_A)], cosy: [answerOf(SIMILAR_B), answerOf(along(0, 1.5, 0, 1.5))], work: [answerOf(FRONT)] });

      await allThree(model);

      const [first, second] = model.callsFor("cosy");
      expect(first).toMatchObject({ alongside: ["spacious", "work"], avoid: [] });
      expect(second.style).toBe("cosy");
      expect(second.alongside).toEqual([]);
      expect(second.avoid).toEqual([
        { style: "spacious", poses: SIMILAR_A },
        { style: "work", poses: FRONT },
      ]);
      expect(second.feedback).toBeUndefined();
    });

    it("chooses the weakest: the one with the fewest pieces in places of its own, even when it is the first style", async () => {
      // A has none in a place of its own, B has one, C has three; A is the first style.
      const A = along(0, 0, 0, 0);
      const B = along(1.5, 0, 0, 0);
      const C = along(0, 1.5, 1.5, 1.5);
      const model = fakeModel({ spacious: [answerOf(A), answerOf(along(-1.5, -1.5, -1.5, -1.5))], cosy: [answerOf(B)], work: [answerOf(C)] });

      await allThree(model);

      expect(model.callsFor("spacious")).toHaveLength(2);
      expect(model.callsFor("cosy")).toHaveLength(1);
      expect(model.callsFor("work")).toHaveLength(1);
    });

    it("chooses the later style when two are as weak as each other", async () => {
      const model = fakeModel({ spacious: [answerOf(SIMILAR_A)], cosy: [answerOf(SIMILAR_B), answerOf(along(0, 1.5, 0, 1.5))], work: [answerOf(FRONT)] });

      await allThree(model);

      // Both the first and the second have one piece in a place of their own: the second is made again.
      expect(model.callsFor("spacious")).toHaveLength(1);
      expect(model.callsFor("cosy")).toHaveLength(2);
    });

    it("fails the layout, as too much like the others, with how many pieces were in places of their own and how many are needed, when the second try is too much like them as well", async () => {
      const model = fakeModel({ spacious: [answerOf(SIMILAR_A)], cosy: [answerOf(SIMILAR_B), answerOf(SIMILAR_B)], work: [answerOf(FRONT)] });

      const outcomes = await allThree(model);

      expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
      expect(failureOf(outcomes[1])).toEqual({ code: "too_similar", own: 1, needed: 2, pieces: 4 });
      // One more call than for three layouts that are different, and no more.
      expect(model.generate).toHaveBeenCalledTimes(4);
    });

    it("is satisfied with the two that are left when it fails the third: they are compared with each other only", async () => {
      // The first and the second are the same, and the third is different: the second goes, and the first has only the third to differ from.
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(BACK), answerOf(BACK)], work: [answerOf(FRONT)] });

      const outcomes = await allThree(model);

      expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
      expect(failureOf(outcomes[1])).toMatchObject({ code: "too_similar", own: 0, needed: 2, pieces: 4 });
    });

    it("makes only one layout again in all, however many are too much like the others", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(BACK)], work: [answerOf(BACK), answerOf(BACK)] });

      const outcomes = await allThree(model);

      // The later style is made again, is the same again, and fails; then the second fails; the first is left, with nothing to be like.
      expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, false]);
      expect(outcomes.slice(1).map((outcome) => failureOf(outcome).code)).toEqual(["too_similar", "too_similar"]);
      expect(model.generate).toHaveBeenCalledTimes(4);
      expect(model.callsFor("work")).toHaveLength(2);
    });

    it("says that the style could not be made, and not that it was too much like the others, when the second try fails", async () => {
      const model = fakeModel({ spacious: [answerOf(SIMILAR_A)], cosy: [answerOf(SIMILAR_B), { text: "no" }, { text: "no again" }], work: [answerOf(FRONT)] });

      const outcomes = await allThree(model);

      expect(failureOf(outcomes[1]).code).toBe("invalid_answer");
      // The first and the third are compared with each other once the second has gone: different enough.
      expect(outcomes[0].ok && outcomes[2].ok).toBe(true);
      // 3 first tries, and the second try of the second style, which was asked twice.
      expect(model.generate).toHaveBeenCalledTimes(5);
    });

    it("says that the call failed when the call of the second try fails", async () => {
      const down = new Error("503");
      const model = fakeModel({ spacious: [answerOf(SIMILAR_A)], cosy: [answerOf(SIMILAR_B), down], work: [answerOf(FRONT)] });

      const outcomes = await allThree(model);

      const failure = failureOf(outcomes[1]);
      expect(failure.code === "error" && failure.error).toBe(down);
    });

    it("counts the description of the new layout, and not that of the one it replaced", async () => {
      const model = fakeModel({ spacious: [answerOf(SIMILAR_A)], cosy: [answerOf(SIMILAR_B, "The first try."), answerOf(along(0, 1.5, 0, 1.5), "The second try.")], work: [answerOf(FRONT)] });

      const outcomes = await allThree(model);

      expect(okOf(outcomes[1]).description).toBe("The second try.");
    });
  });

  it("compares only two layouts with each other when only two styles are asked for, and fails the later one if they are alike", async () => {
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(BACK), answerOf(BACK)] });

    const outcomes = await generateLayouts(description, ["spacious", "cosy"], model.generate);

    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false]);
  });

  it("does not hold a layout against itself, or against a style that failed: one layout alone is always different enough", async () => {
    const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [{ text: "x" }, { text: "y" }], work: [new Error("down")] });

    const outcomes = await allThree(model);

    expect(outcomes[0].ok).toBe(true);
    expect(model.callsFor("spacious")).toHaveLength(1);
  });

  it("counts a piece as in a place of its own only when it is 50 cm or more from where it is in each of the others", async () => {
    // The second layout moves two pieces by 0.4 m (not enough) and two by 0.6 m: half of the pieces differ, and it passes.
    const base = along(-1.5, -1.5, -1.5, -1.5);
    const nearly = along(-1.1, -1.1, -0.9, -0.9);
    const model = fakeModel({ spacious: [answerOf(base)], cosy: [answerOf(nearly)] });

    const outcomes = await generateLayouts(description, ["spacious", "cosy"], model.generate);

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(model.generate).toHaveBeenCalledTimes(2);
  });
});

describe("generateLayouts: one style made again, with the layouts that are already made (US-21 AC4)", () => {
  const existing = [
    { style: "spacious" as const, poses: BACK },
    { style: "work" as const, poses: FRONT },
  ];

  it("shows the model the layouts that are made already, from the first try, and does not say that others are made at the same time", async () => {
    const model = fakeModel({ cosy: [answerOf(MIDDLE)] });

    await generateLayouts(description, ["cosy"], model.generate, existing);

    expect(model.requests).toHaveLength(1);
    expect(model.requests[0].style).toBe("cosy");
    expect(model.requests[0].alongside).toEqual([]);
    expect(model.requests[0].avoid).toEqual(existing);
  });

  it("gives only the layout that was asked for, and not the ones that were made", async () => {
    const model = fakeModel({ cosy: [answerOf(MIDDLE)] });

    const outcomes = await generateLayouts(description, ["cosy"], model.generate, existing);

    expect(outcomes).toHaveLength(1);
    expect(okOf(outcomes[0]).poses).toEqual(MIDDLE);
  });

  it("holds the new layout to the old ones, and fails it as too much like them, without a second try since it was told them the first time", async () => {
    const model = fakeModel({ cosy: [answerOf(BACK)] });

    const outcomes = await generateLayouts(description, ["cosy"], model.generate, existing);

    expect(failureOf(outcomes[0])).toEqual({ code: "too_similar", own: 0, needed: 2, pieces: 4 });
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("is happy with a new layout that is like only one of the old ones, if half of its pieces differ from both", async () => {
    const half = along(-1.5, -1.5, 0, 0);
    const model = fakeModel({ cosy: [answerOf(half)] });

    const outcomes = await generateLayouts(description, ["cosy"], model.generate, existing);

    expect(okOf(outcomes[0]).poses).toEqual(half);
  });

  it("does not hold the old layouts against each other, or change them: it is the new one that has to differ", async () => {
    const sameOld = [{ style: "spacious" as const, poses: BACK }, { style: "work" as const, poses: BACK }];
    const model = fakeModel({ cosy: [answerOf(MIDDLE)] });

    const outcomes = await generateLayouts(description, ["cosy"], model.generate, sameOld);

    expect(outcomes[0].ok).toBe(true);
    expect(sameOld[0].poses).toBe(BACK);
  });

  it("does not change what it is given", async () => {
    const frozen = Object.freeze([Object.freeze({ style: "spacious" as const, poses: Object.freeze([...BACK]) }), Object.freeze({ style: "work" as const, poses: Object.freeze([...FRONT]) })]);
    const model = fakeModel({ cosy: [answerOf(MIDDLE)] });

    await expect(generateLayouts(description, Object.freeze(["cosy"] as const), model.generate, frozen)).resolves.toHaveLength(1);
  });
});
