import { describe, expect, it } from "vitest";
import { FURNITURE_LABELS } from "../shared/furniture";
import { MAX_LAYOUT_PIECES } from "../shared/layout";
import { layoutAnswerSchema, layoutJsonSchema, parseLayoutAnswer } from "./layout-schema";

const items = [{ label: "sofa" }, { label: "coffee_table" }, { label: "tv_stand" }] as const;

const entry = (index: number, label: string, x_m = 0, z_m = 0, rotation_deg = 0) => ({ index, label, x_m, z_m, rotation_deg });
const answer = (...pieces: unknown[]) => JSON.stringify({ pieces });
const good = answer(entry(0, "sofa", 0, 1.4, 180), entry(1, "coffee_table", 0, 0.3), entry(2, "tv_stand", 0, -1.7));

const reasonOf = (text: string | undefined, list: readonly { label: string }[] = items) => {
  const result = parseLayoutAnswer(text, list as never);
  if (result.ok) throw new Error("the answer was accepted");
  return result.reason;
};

describe("parseLayoutAnswer: an answer with every piece once and nothing else (AC2)", () => {
  it("accepts an answer with one entry for each piece, and gives the poses in the order of the list", () => {
    expect(parseLayoutAnswer(good, items)).toEqual({
      ok: true,
      poses: [
        { x_m: 0, z_m: 1.4, rotation_deg: 180 },
        { x_m: 0, z_m: 0.3, rotation_deg: 0 },
        { x_m: 0, z_m: -1.7, rotation_deg: 0 },
      ],
    });
  });

  it("gives the poses in the order of the list when the answer has them in another order", () => {
    const shuffled = answer(entry(2, "tv_stand", 3, 3), entry(0, "sofa", 1, 1), entry(1, "coffee_table", 2, 2));

    const result = parseLayoutAnswer(shuffled, items);

    expect(result.ok && result.poses.map((pose) => pose.x_m)).toEqual([1, 2, 3]);
  });

  it("turns the rotation into 0 up to 360, and rounds the numbers to a millimetre and a tenth of a degree", () => {
    const text = answer(entry(0, "sofa", 1.23456, -0.00049, -90), entry(1, "coffee_table", 0, 0, 450.04), entry(2, "tv_stand", 0, 0, 720));

    const result = parseLayoutAnswer(text, items);

    expect(result).toEqual({
      ok: true,
      poses: [
        { x_m: 1.235, z_m: -0, rotation_deg: 270 },
        { x_m: 0, z_m: 0, rotation_deg: 90 },
        { x_m: 0, z_m: 0, rotation_deg: 0 },
      ],
    });
  });

  it("rounds z to a millimetre as it does x, and the rotation to a tenth of a degree", () => {
    const text = answer(entry(0, "sofa", 0.1234, 1.2346, 12.34), entry(1, "coffee_table"), entry(2, "tv_stand"));

    const result = parseLayoutAnswer(text, items);

    expect(result.ok && result.poses[0]).toEqual({ x_m: 0.123, z_m: 1.235, rotation_deg: 12.3 });
  });

  it("keeps what it says back to the model to 700 characters, however much is wrong with the answer", () => {
    const wrongEverywhere = JSON.stringify({ pieces: Array.from({ length: 200 }, () => ({ index: "x", label: 1 })) });
    const unreadable = parseLayoutAnswer("{", items, "n".repeat(2000));

    expect(reasonOf(wrongEverywhere)).toHaveLength(700);
    expect(unreadable.ok ? "" : unreadable.reason).toHaveLength(700);
    expect(unreadable.ok ? "" : unreadable.reason).toMatch(/^not valid JSON \(nnnn/);
  });

  it("ignores fields that it did not ask for", () => {
    const text = JSON.stringify({ pieces: [{ ...entry(0, "sofa"), note: "against the wall" }], reasoning: "..." });

    expect(parseLayoutAnswer(text, [{ label: "sofa" }]).ok).toBe(true);
  });

  it("accepts an empty list for an empty answer", () => {
    expect(parseLayoutAnswer('{"pieces":[]}', [])).toEqual({ ok: true, poses: [] });
  });

  it.each([
    ["no text at all", undefined, /empty answer/],
    ["blank text", "  ", /empty answer/],
    ["text that is not JSON", "Here is the layout: sofa at 0, 1", /not valid JSON/],
    ["JSON cut off halfway", '{"pieces":[{"index":0,"label":"sofa"', /not valid JSON/],
    ["no pieces field", "{}", /pieces/],
    ["pieces that is not a list", '{"pieces":"sofa"}', /pieces/],
  ])("rejects %s", (_name, text, reason) => {
    expect(reasonOf(text)).toMatch(reason);
  });

  it.each([
    ["a missing field", entry(0, "sofa"), { x_m: undefined }, /x_m/],
    ["a position that is not a number", entry(0, "sofa"), { z_m: "front" }, /z_m/],
    ["a rotation that is not a number", entry(0, "sofa"), { rotation_deg: "left" }, /rotation_deg/],
    ["a position far outside any room", entry(0, "sofa"), { x_m: 40 }, /x_m/],
    ["a number for the piece that is not a whole number", entry(0, "sofa"), { index: 1.5 }, /index/],
    ["a negative number for the piece", entry(0, "sofa"), { index: -1 }, /index/],
    ["a type that is not supported", entry(0, "sofa"), { label: "wardrobe" }, /label/],
  ])("rejects an entry with %s", (_name, base, change, reason) => {
    const text = answer({ ...base, ...change }, entry(1, "coffee_table"), entry(2, "tv_stand"));

    expect(reasonOf(text)).toMatch(reason);
  });

  it("includes why the model stopped in the reason", () => {
    expect(reasonOf(undefined)).toBe("empty answer");
    expect(parseLayoutAnswer(undefined, items, "SAFETY")).toEqual({ ok: false, reason: "empty answer (SAFETY)" });
  });

  describe("a list of pieces that is not the one that was asked about", () => {
    it("rejects an answer that leaves a piece out, and says which", () => {
      expect(reasonOf(answer(entry(0, "sofa"), entry(2, "tv_stand")))).toBe("Piece 1 (coffee_table) is not in the answer.");
    });

    it("rejects an answer with a piece twice, and says which, and that the other piece is missing", () => {
      const text = answer(entry(0, "sofa"), entry(1, "coffee_table"), entry(1, "coffee_table", 1, 1));

      expect(reasonOf(text)).toBe("Piece 1 is in the answer more than once. Piece 2 (tv_stand) is not in the answer.");
    });

    it("rejects an answer with a piece that is not in the list: no extra pieces", () => {
      const text = answer(entry(0, "sofa"), entry(1, "coffee_table"), entry(2, "tv_stand"), entry(3, "rug"));

      expect(reasonOf(text)).toBe("The answer has a piece number 3, but the list has 3 pieces, numbers 0 to 2.");
    });

    it("says it right for a list of one piece", () => {
      expect(reasonOf(answer(entry(0, "sofa"), entry(1, "sofa")), [{ label: "sofa" }])).toBe("The answer has a piece number 1, but the list has 1 piece, number 0.");
    });

    it("rejects an answer that numbers the pieces from 1, which shows as a missing first piece and an extra last one", () => {
      const text = answer(entry(1, "sofa"), entry(2, "coffee_table"), entry(3, "tv_stand"));

      expect(reasonOf(text)).toContain("The answer has a piece number 3");
      expect(reasonOf(text)).toContain("Piece 0 (sofa) is not in the answer.");
    });

    it("rejects an entry that calls a piece by another type than the list does", () => {
      const text = answer(entry(0, "sofa"), entry(1, "desk"), entry(2, "tv_stand"));

      expect(reasonOf(text)).toBe("Piece 1 is a coffee_table in the list, but the answer calls it a desk.");
    });

    it("rejects an answer with no pieces at all for a list that has some", () => {
      expect(reasonOf('{"pieces":[]}')).toBe("Piece 0 (sofa) is not in the answer. Piece 1 (coffee_table) is not in the answer. Piece 2 (tv_stand) is not in the answer.");
    });

    it("does not say that there are more problems when it has told every one", () => {
      const five = Array.from({ length: 5 }, () => ({ label: "rug" }));

      expect(reasonOf('{"pieces":[]}', five)).toBe(Array.from({ length: 5 }, (_, index) => `Piece ${index} (rug) is not in the answer.`).join(" "));
    });

    it("tells the first problems and how many more there are, so that what is said back to the model stays short", () => {
      const many = Array.from({ length: 9 }, () => ({ label: "rug" }));

      const reason = reasonOf('{"pieces":[]}', many);

      expect(reason).toBe("Piece 0 (rug) is not in the answer. Piece 1 (rug) is not in the answer. Piece 2 (rug) is not in the answer. Piece 3 (rug) is not in the answer. Piece 4 (rug) is not in the answer. And 4 more.");
    });
  });
});

describe("layoutJsonSchema: what Gemini is asked to answer with", () => {
  type Schema = { $schema?: string; type: string; properties: { pieces: { type: string; items: { type: string; required: string[]; properties: Record<string, { type: string; description?: string; minimum?: number; maximum?: number; enum?: string[] }> } } } };
  const schema = layoutJsonSchema() as unknown as Schema;
  const piece = schema.properties.pieces.items;

  it("is an object with a list of pieces, without the keyword that Gemini does not accept", () => {
    expect(schema.type).toBe("object");
    expect(schema.properties.pieces.type).toBe("array");
    expect(schema.$schema).toBeUndefined();
  });

  it("asks for all five values of every piece", () => {
    expect(piece.required.sort()).toEqual(["index", "label", "rotation_deg", "x_m", "z_m"]);
  });

  it("says what each value means, so that the model knows", () => {
    for (const name of Object.keys(piece.properties)) expect(piece.properties[name].description?.length, name).toBeGreaterThan(20);
  });

  it("has the number of the piece as a whole number from 0 up to the most pieces there can be", () => {
    expect(piece.properties.index).toMatchObject({ type: "integer", minimum: 0, maximum: MAX_LAYOUT_PIECES - 1 });
  });

  it("has the types of furniture there are, and no others", () => {
    expect(piece.properties.label.enum).toEqual([...FURNITURE_LABELS]);
  });

  it("keeps the positions within half of the biggest room there can be", () => {
    expect(piece.properties.x_m).toMatchObject({ minimum: -10, maximum: 10 });
    expect(piece.properties.z_m).toMatchObject({ minimum: -10, maximum: 10 });
  });

  it("is the schema that the answers are checked with", () => {
    expect(layoutAnswerSchema.safeParse(JSON.parse(good)).success).toBe(true);
    expect(layoutAnswerSchema.safeParse({ pieces: [{ index: 0 }] }).success).toBe(false);
  });
});
