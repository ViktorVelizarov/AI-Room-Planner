import { afterEach, describe, expect, it, vi } from "vitest";
import { typicalItem, type FurnitureItem } from "../shared/furniture";
import type { Pose } from "../shared/layout";
import { FIX_ATTEMPTS, describeProblems, findProblems, fixLayout, isValid } from "../shared/layout-fix";
import { CROWDED_FINE, CROWDED_UNFIXABLE, crowdedAnswer, crowdedRoom } from "../test/crowded-room";
import { MissingApiKeyError, generateLayoutWithGemini, layoutRequestParts } from "./gemini";
import { LayoutError, LayoutOverlapError, MAX_LAYOUT_ATTEMPTS, RoomTooFullError, finishLayout, generateLayout } from "./layout";
import type { GenerateLayoutFn, ModelAnswer } from "./types";

const sofa: FurnitureItem = { ...typicalItem("sofa"), width_cm: 200, depth_cm: 90 };
const table: FurnitureItem = { ...typicalItem("coffee_table"), width_cm: 100, depth_cm: 60 };
const stand: FurnitureItem = { ...typicalItem("tv_stand"), width_cm: 140, depth_cm: 40 };
const rug: FurnitureItem = { ...typicalItem("rug"), width_cm: 160, depth_cm: 230 };
const room = { width_m: 5, length_m: 4, height_m: 2.5 };
const description = { room, furniture: [sofa, table, stand, rug] };

/** A layout of the room above that is fine: the sofa faces the TV stand across the table, and the rug lies under the table. */
const fine: Pose[] = [
  { x_m: 0, z_m: 1.45, rotation_deg: 180 },
  { x_m: 0, z_m: 0.35, rotation_deg: 0 },
  { x_m: 0, z_m: -1.75, rotation_deg: 0 },
  { x_m: 0, z_m: 0.4, rotation_deg: 0 },
];

const labels = description.furniture.map((item) => item.label);
const answerFor = (poses: Pose[], usage = { inputTokens: 100, outputTokens: 20 }): ModelAnswer => ({
  text: JSON.stringify({ pieces: poses.map((pose, index) => ({ index, label: labels[index], ...pose })) }),
  usage,
});

describe("generateLayout", () => {
  it("asks the model once when the first answer is a layout, and gives the poses in the order of the list (AC1)", async () => {
    const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(answerFor(fine));

    const result = await generateLayout(description, generate);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({ description, feedback: undefined });
    expect(result).toEqual({ poses: fine, adjusted: [], attempts: 1, usage: { inputTokens: 100, outputTokens: 20 } });
  });

  it("gives a pose to every piece of the list, in its order, whatever the order of the answer (AC2)", async () => {
    const reversed: ModelAnswer = {
      text: JSON.stringify({ pieces: fine.map((pose, index) => ({ index, label: labels[index], ...pose })).reverse() }),
    };
    const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(reversed);

    const result = await generateLayout(description, generate);

    expect(result.poses).toEqual(fine);
  });

  it("uses a layout that is fine exactly as the model gave it, also when pieces only touch", async () => {
    // The sofa (z from 1.1 to 2) is against the front wall, the table (z from 0.5 to 1.1) touches the sofa, and the TV stand (0.4 deep) is against the back wall.
    const touching: Pose[] = [
      { x_m: 0, z_m: 1.55, rotation_deg: 180 },
      { x_m: 0, z_m: 0.8, rotation_deg: 0 },
      { x_m: 0, z_m: -1.8, rotation_deg: 0 },
      { x_m: 0, z_m: 0.4, rotation_deg: 0 },
    ];
    const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(answerFor(touching));

    const result = await generateLayout(description, generate);

    expect(result.poses).toEqual(touching);
    expect(result.adjusted).toEqual([]);
  });

  describe("a layout with pieces in each other or through a wall", () => {
    const flawed: Pose[] = [
      { x_m: 0, z_m: 1.45, rotation_deg: 180 },
      { x_m: 0, z_m: 0.9, rotation_deg: 0 },
      { x_m: 0, z_m: -2, rotation_deg: 0 },
      { x_m: 0, z_m: 0.4, rotation_deg: 0 },
    ];

    it("is fixed in code, and the model is not asked again", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(answerFor(flawed));

      const result = await generateLayout(description, generate);

      expect(generate).toHaveBeenCalledTimes(1);
      expect(result.attempts).toBe(1);
      expect(isValid(findProblems(description.furniture, result.poses, room))).toBe(true);
    });

    it("says which pieces were moved, and moves nothing else and turns nothing", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(answerFor(flawed));

      const result = await generateLayout(description, generate);

      // The table was in the sofa, which moves a little too, and the TV stand was through the wall.
      expect(result.adjusted).toEqual([0, 1, 2]);
      expect(result.poses[3]).toEqual(flawed[3]);
      expect(result.poses.map((pose) => pose.rotation_deg)).toEqual(flawed.map((pose) => pose.rotation_deg));
    });
  });

  describe("a layout that cannot be fixed (US-22 AC3)", () => {
    it("is not used: it throws a LayoutOverlapError, which says what is wrong and that the attempts to fix it were made", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(crowdedAnswer(CROWDED_UNFIXABLE));

      const error = await generateLayout(crowdedRoom, generate).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LayoutOverlapError);
      const overlap = error as LayoutOverlapError;
      expect(overlap.problems.length).toBeGreaterThan(0);
      expect(overlap.problems.every((problem) => /\(item \d\)/.test(problem))).toBe(true);
      expect(overlap.message).toBe(`The layout still has problems after ${FIX_ATTEMPTS} attempts to fix it: ${overlap.problems.join(" ")}`);
      expect(overlap.message).toContain("after 3 attempts to fix it");
    });

    it("is not asked for again: the attempts are to fix it, in code, and the model is asked once, which is one paid call", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(crowdedAnswer(CROWDED_UNFIXABLE));

      await generateLayout(crowdedRoom, generate).catch(() => {});

      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("is the answer that is at fault and not the room: a fine arrangement of the same room is used as it is", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(crowdedAnswer(CROWDED_FINE));

      const result = await generateLayout(crowdedRoom, generate);

      expect(result.poses).toEqual(CROWDED_FINE);
      expect(result.adjusted).toEqual([]);
    });
  });

  describe("an answer that is not a layout (AC3)", () => {
    const missing: ModelAnswer = { text: JSON.stringify({ pieces: fine.slice(0, 2).map((pose, index) => ({ index, label: labels[index], ...pose })) }), usage: { inputTokens: 50, outputTokens: 5 } };

    it("is asked for again once, and the second answer is used", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValueOnce(missing).mockResolvedValueOnce(answerFor(fine));

      const result = await generateLayout(description, generate);

      expect(generate).toHaveBeenCalledTimes(2);
      expect(result.poses).toEqual(fine);
      expect(result.attempts).toBe(2);
    });

    it("tells the model what was wrong the second time, and not the first time", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValueOnce(missing).mockResolvedValueOnce(answerFor(fine));

      await generateLayout(description, generate);

      expect(generate.mock.calls[0][0].feedback).toBeUndefined();
      expect(generate.mock.calls[1][0].feedback).toBe("Piece 2 (tv_stand) is not in the answer. Piece 3 (rug) is not in the answer.");
      expect(generate.mock.calls[1][0].description).toBe(description);
    });

    it("adds up the tokens of both attempts", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValueOnce(missing).mockResolvedValueOnce(answerFor(fine));

      const result = await generateLayout(description, generate);

      expect(result.usage).toEqual({ inputTokens: 150, outputTokens: 25 });
    });

    it.each([
      ["text that is not JSON", { text: "Here is a layout: sofa at the back" }],
      ["no text at all", { text: undefined, note: "SAFETY" }],
      ["a piece twice", { text: JSON.stringify({ pieces: [...fine, fine[0]].map((pose, index) => ({ index: Math.min(index, 3), label: labels[Math.min(index, 3)], ...pose })) }) }],
      ["a piece that is not in the list", { text: JSON.stringify({ pieces: [...fine, fine[0]].map((pose, index) => ({ index, label: labels[index] ?? "sofa", ...pose })) }) }],
      ["a piece called by another type", { text: JSON.stringify({ pieces: fine.map((pose, index) => ({ index, label: "bed", ...pose })) }) }],
    ] as [string, ModelAnswer][])("asks again for %s", async (_name, bad) => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValueOnce(bad).mockResolvedValueOnce(answerFor(fine));

      const result = await generateLayout(description, generate);

      expect(result.attempts).toBe(2);
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it("throws, without using any of it, when the second answer is not a layout either, and does not ask a third time", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValueOnce(missing).mockResolvedValueOnce({ text: "I cannot do that" });

      const error = await generateLayout(description, generate).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LayoutError);
      const layout = error as LayoutError;
      expect(layout.attempts).toBe(2);
      expect(layout.reasons[0]).toMatch(/Piece 2 \(tv_stand\) is not in the answer/);
      expect(layout.reasons[1]).toMatch(/not valid JSON/);
      expect(generate).toHaveBeenCalledTimes(MAX_LAYOUT_ATTEMPTS);
      expect(MAX_LAYOUT_ATTEMPTS).toBe(2);
    });

    it("says how many answers there were and what was wrong with the last one, in the message of the error", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValueOnce(missing).mockResolvedValueOnce({ text: "I cannot do that" });

      const error = (await generateLayout(description, generate).catch((e: unknown) => e)) as LayoutError;

      expect(error.message).toBe(`The model did not return a valid layout after 2 attempts. Last problem: ${error.reasons[1]}`);
    });

    it("passes on why the model stopped when it gave no text", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue({ text: undefined, note: "MAX_TOKENS" });

      const error = (await generateLayout(description, generate).catch((e: unknown) => e)) as LayoutError;

      expect(error.reasons).toEqual(["empty answer (MAX_TOKENS)", "empty answer (MAX_TOKENS)"]);
    });
  });

  it("counts no tokens for an answer that does not say how many it used", async () => {
    const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue({ text: answerFor(fine).text });

    const result = await generateLayout(description, generate);

    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("does not ask again when the call itself fails", async () => {
    const generate = vi.fn<GenerateLayoutFn>().mockRejectedValue(new Error("fetch failed"));

    await expect(generateLayout(description, generate)).rejects.toThrow("fetch failed");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  describe("a room that cannot hold the pieces", () => {
    it("is refused before the model is asked, so that no call is spent", async () => {
      const generate = vi.fn<GenerateLayoutFn>();
      const full = { room: { ...room, width_m: 4, length_m: 3 }, furniture: Array.from({ length: 6 }, () => sofa) };

      const error = await generateLayout(full, generate).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RoomTooFullError);
      expect((error as Error).message).toMatch(/^Your furniture would cover 90% of the floor/);
      expect(generate).not.toHaveBeenCalled();
    });

    it("names a piece that is bigger than the room", async () => {
      const generate = vi.fn<GenerateLayoutFn>();

      const error = await generateLayout({ room: { ...room, width_m: 1.5, length_m: 1.5 }, furniture: [table, sofa] }, generate).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RoomTooFullError);
      expect((error as Error).message).toMatch(/^Sofa \(item 2\) is bigger than the room/);
      expect(generate).not.toHaveBeenCalled();
    });
  });
});

describe("finishLayout: a layout that has the right shape made fine", () => {
  it("leaves a layout that is fine as it is", () => {
    expect(finishLayout(description, fine)).toEqual({ poses: fine, adjusted: [] });
  });

  it("throws, with the problems as sentences, when the pieces cannot be made fine", () => {
    const tiny = { room: { ...room, width_m: 2.2, length_m: 1.2 }, furniture: [sofa, sofa, table] };

    const error = (() => {
      try {
        finishLayout(tiny, [{ x_m: 0, z_m: 0, rotation_deg: 0 }, { x_m: 0.1, z_m: 0.1, rotation_deg: 0 }, { x_m: -0.1, z_m: 0, rotation_deg: 0 }]);
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(error).toBeInstanceOf(LayoutOverlapError);
    const overlap = error as LayoutOverlapError;
    expect(overlap.problems.length).toBeGreaterThan(0);
    expect(overlap.problems[0]).toMatch(/\(item \d\)/);
    expect(overlap.message).toContain(overlap.problems[0]);
    expect(overlap.message).toContain("after 3 attempts to fix it");
  });

  it("says what is wrong with the layout as far as it could be fixed, not as it was given", () => {
    // Two bookshelves, one across a room of 1 m x 1 m and one along it, cross wherever they are put. The first was also put through the right wall, which the fixing does mend.
    const shelf = (width_cm: number, depth_cm: number): FurnitureItem => ({ ...typicalItem("bookshelf"), width_cm, depth_cm });
    const crossing = { room: { ...room, width_m: 1, length_m: 1 }, furniture: [shelf(100, 10), shelf(10, 100)] };
    const given: Pose[] = [{ x_m: 0.6, z_m: 0.45, rotation_deg: 0 }, { x_m: 0.3, z_m: 0, rotation_deg: 0 }];
    const fixed = fixLayout(crossing.furniture, given, crossing.room);
    const sentences = (poses: Pose[]) => describeProblems(crossing.furniture, findProblems(crossing.furniture, poses, crossing.room));

    const error = (() => {
      try {
        finishLayout(crossing, given);
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(fixed.ok).toBe(false);
    expect(error).toBeInstanceOf(LayoutOverlapError);
    expect((error as LayoutOverlapError).problems).toEqual(sentences(fixed.poses));
    expect((error as LayoutOverlapError).problems).not.toEqual(sentences(given));
  });
});

describe("the request to Gemini", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is the instructions as one piece of text, with no photos", () => {
    const parts = layoutRequestParts({ description });

    expect(parts).toHaveLength(1);
    expect(parts[0].text).toContain("The room is 5 m wide and 4 m long.");
    expect(parts[0].text).toContain("0: sofa, 200 x 90 cm");
  });

  it("has what was wrong with the answer before, when there was one", () => {
    const [part] = layoutRequestParts({ description, feedback: "Piece 1 (coffee_table) is not in the answer." });

    expect(part.text).toContain("YOUR PREVIOUS ANSWER COULD NOT BE USED: Piece 1 (coffee_table) is not in the answer.");
  });

  it("has the style, the styles made at the same time and the layouts that are already made, when it is given them (US-21)", () => {
    const [part] = layoutRequestParts({ description, style: "cosy", alongside: ["work"], avoid: [{ style: "spacious", poses: fine }] });

    expect(part.text).toContain("THE STYLE OF THIS LAYOUT: COSY");
    expect(part.text).toContain("ALREADY MADE");
    expect(part.text).toContain("The Spacious layout puts the pieces here");
    expect(part.text).toContain('"description"');
  });

  it("has no style when it is not given one", () => {
    const [part] = layoutRequestParts({ description, alongside: ["work"] });

    expect(part.text).not.toContain("THE STYLE OF THIS LAYOUT");
  });

  it("reports a missing API key before sending anything", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(generateLayoutWithGemini({ description })).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("is what generateLayout asks when it is not given another way to ask, which with no API key is an error and no call", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(generateLayout(description)).rejects.toBeInstanceOf(MissingApiKeyError);
  });
});

describe("generateLayout: a layout in a style (US-21)", () => {
  const withDescription = (poses: Pose[], text: unknown): ModelAnswer => ({
    text: JSON.stringify({ description: text, pieces: poses.map((pose, index) => ({ index, label: labels[index], ...pose })) }),
    usage: { inputTokens: 10, outputTokens: 5 },
  });

  it("gives the model the style, and what it is to differ from, with the room, in every call, the retry too", async () => {
    const avoid = [{ style: "spacious" as const, poses: fine }];
    const generate = vi.fn<GenerateLayoutFn>().mockResolvedValueOnce({ text: "no" }).mockResolvedValueOnce(answerFor(fine));

    await generateLayout(description, generate, { style: "cosy", alongside: ["work"], avoid });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0]).toEqual({ description, feedback: undefined, style: "cosy", alongside: ["work"], avoid });
    expect(generate.mock.calls[1][0]).toEqual({ description, feedback: expect.stringMatching(/not valid JSON/), style: "cosy", alongside: ["work"], avoid });
  });

  it("gives the description that the model wrote, with the poses", async () => {
    const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(withDescription(fine, "Everything is close together. The rug is the middle of the room."));

    const result = await generateLayout(description, generate, { style: "cosy" });

    expect(result.description).toBe("Everything is close together. The rug is the middle of the room.");
    expect(result.poses).toEqual(fine);
  });

  it("has no description when the answer had none, or none that can be used, and does not ask again for that", async () => {
    for (const text of [undefined, "", null, 12, "x".repeat(500)]) {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(withDescription(fine, text));

      const result = await generateLayout(description, generate, { style: "cosy" });

      expect("description" in result, String(text)).toBe(false);
      expect(generate).toHaveBeenCalledTimes(1);
    }
  });

  it("gives the description of the answer that was used: that of the second try, when the first was not usable", async () => {
    const generate = vi.fn<GenerateLayoutFn>().mockResolvedValueOnce({ text: "{}" }).mockResolvedValueOnce(withDescription(fine, "The second try."));

    const result = await generateLayout(description, generate, { style: "work" });

    expect(result.description).toBe("The second try.");
    expect(result.attempts).toBe(2);
  });

  it("still fixes a layout with pieces in each other, and says which, as for a layout with no style", async () => {
    const overlapping = fine.map((pose, index) => (index === 1 ? { ...pose, z_m: 0.9 } : pose));
    const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(withDescription(overlapping, "Open."));

    const result = await generateLayout(description, generate, { style: "spacious" });

    expect(result.adjusted.length).toBeGreaterThan(0);
    expect(isValid(findProblems(description.furniture, result.poses, room))).toBe(true);
    expect(result.description).toBe("Open.");
  });

  it("refuses a room that is too full without asking the model, in a style too", async () => {
    const generate = vi.fn<GenerateLayoutFn>();

    await expect(generateLayout({ room: { ...room, width_m: 1, length_m: 1 }, furniture: [sofa] }, generate, { style: "cosy" })).rejects.toBeInstanceOf(RoomTooFullError);
    expect(generate).not.toHaveBeenCalled();
  });
});
