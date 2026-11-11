import { describe, expect, it } from "vitest";
import { FURNITURE_LABELS } from "../shared/furniture";
import { MAX_LAYOUT_PIECES } from "../shared/layout";
import { MAX_DESCRIPTION_LENGTH, cleanDescription, layoutAnswerSchema, layoutJsonSchema, parseLayoutAnswer } from "./layout-schema";

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

  it("has an optional description, as text, that says what it is for, besides the pieces (US-21 AC2)", () => {
    const withDescription = layoutJsonSchema() as unknown as { properties: { description: { type: string; description: string } }; required?: string[] };

    expect(withDescription.properties.description.type).toBe("string");
    expect(withDescription.properties.description.description).toMatch(/one or two plain sentences/);
    // Optional, so that an answer for a layout that was not asked for in a style is still an answer.
    expect(withDescription.required ?? []).toEqual(["pieces"]);
  });

  it("has the description required, with the same words about it, for a layout in a style, because the model leaves out what is only optional", () => {
    const styled = layoutJsonSchema({ withDescription: true }) as unknown as { properties: { description: { type: string; description: string }; pieces: { type: string } }; required: string[]; $schema?: string };

    expect([...styled.required].sort()).toEqual(["description", "pieces"]);
    expect(styled.properties.description.type).toBe("string");
    expect(styled.properties.description.description).toMatch(/one or two plain sentences/);
    expect(styled.properties.pieces.type).toBe("array");
    expect(styled.$schema).toBeUndefined();
  });

  it("is the schema without a required description when it is asked for nothing, or for the description not to be", () => {
    const plain = (value: unknown) => (value as { required?: string[] }).required;

    expect(plain(layoutJsonSchema())).toEqual(["pieces"]);
    expect(plain(layoutJsonSchema({}))).toEqual(["pieces"]);
    expect(plain(layoutJsonSchema({ withDescription: false }))).toEqual(["pieces"]);
  });

  it("is not what answers are held to: an answer without the description, or with one that is not text, is still an answer", () => {
    expect(parseLayoutAnswer(good, items).ok).toBe(true);
    expect(parseLayoutAnswer(JSON.stringify({ description: null, pieces: JSON.parse(good).pieces }), items).ok).toBe(true);
  });
});

describe("cleanDescription: the description of a layout, as it is shown (US-21 AC2)", () => {
  it("is what the model wrote, when it is a sentence or two", () => {
    expect(cleanDescription("Everything stands along the walls. The middle of the room stays open.")).toBe("Everything stands along the walls. The middle of the room stays open.");
    expect(cleanDescription("One sentence only.")).toBe("One sentence only.");
  });

  it("is on one line, with the white space made single and the ends cut off", () => {
    expect(cleanDescription("  A snug group\n\taround the rug.   The lamp is by the sofa.  ")).toBe("A snug group around the rug. The lamp is by the sofa.");
  });

  it("is the first two sentences when there are more", () => {
    expect(cleanDescription("One. Two. Three. Four.")).toBe("One. Two.");
    expect(cleanDescription("The desk is by the wall. The shelf is next to it! Is that all? Yes.")).toBe("The desk is by the wall. The shelf is next to it!");
  });

  it("ends a sentence at a question mark and an exclamation mark as well as at a full stop", () => {
    expect(cleanDescription("Why? Because it is cosy! And more. And more.")).toBe("Why? Because it is cosy!");
  });

  it("does not cut a sentence in the middle of a number or after an abbreviation that goes on in lower case", () => {
    expect(cleanDescription("The paths are 1.5 m wide, e.g. to the desk. The rug is 2.3 m long. A third.")).toBe("The paths are 1.5 m wide, e.g. to the desk. The rug is 2.3 m long.");
  });

  it("starts a new sentence at a quotation mark or a bracket as well as at a capital", () => {
    expect(cleanDescription('Calm. "Open" is the word. More.')).toBe('Calm. "Open" is the word.');
    expect(cleanDescription("Calm. (Open) is the word. More.")).toBe("Calm. (Open) is the word.");
  });

  it("keeps a text that has no full stop at all", () => {
    expect(cleanDescription("an open room with wide paths")).toBe("an open room with wide paths");
  });

  it("is nothing for an empty text, one that is only white space, and what is not text", () => {
    for (const nothing of ["", "   ", "\n\t", undefined, null, 0, 42, true, {}, [], ["a sentence."]]) {
      expect(cleanDescription(nothing), JSON.stringify(nothing)).toBeUndefined();
    }
  });

  it("is nothing for a text longer than 300 characters, after the sentences beyond two have been left out, and so is used as it is up to 300", () => {
    const sentence = (length: number) => "A".repeat(length - 1) + ".";

    expect(MAX_DESCRIPTION_LENGTH).toBe(300);
    expect(cleanDescription(sentence(300))).toHaveLength(300);
    expect(cleanDescription(sentence(301))).toBeUndefined();
    // Two sentences of 150 characters with the space between them make 301, which is too long for two (see below); one character less makes 300.
    expect(cleanDescription(`${sentence(150)} ${sentence(149)}`)).toHaveLength(300);
  });

  it("is the first sentence alone when the first two together are too long but the first is not, so that a description that runs on is not thrown away", () => {
    const first = "A".repeat(149) + ".";
    const second = "B".repeat(150) + ".";

    expect(cleanDescription(`${first} ${second}`)).toBe(first);
    expect(cleanDescription(`${first} ${second} Third one.`)).toBe(first);
  });

  it("is nothing when even the first sentence is too long", () => {
    expect(cleanDescription(`${"A".repeat(300)}. Short.`)).toBeUndefined();
  });

  it("is the two sentences, and not the first alone, when they fit", () => {
    expect(cleanDescription("First one. Second one.")).toBe("First one. Second one.");
  });

  it("does not hold a long third sentence against the first two", () => {
    expect(cleanDescription(`Short one. Short two. ${"B".repeat(500)}.`)).toBe("Short one. Short two.");
  });

  it("does not throw, whatever the text", () => {
    for (const text of ["\u0000", "😀. 😀.", ".".repeat(1000), "A. ".repeat(500), "\\", "{}"]) {
      expect(() => cleanDescription(text), text.slice(0, 10)).not.toThrow();
    }
  });
});

describe("parseLayoutAnswer: the description of the layout (US-21 AC2)", () => {
  const withDescription = (description: unknown) => JSON.stringify({ description, pieces: JSON.parse(good).pieces });

  it("comes with the poses when the answer has one", () => {
    const result = parseLayoutAnswer(withDescription("Snug and sociable. Everything is close to the rug."), items);

    expect(result.ok && result.description).toBe("Snug and sociable. Everything is close to the rug.");
    expect(result.ok && result.poses).toHaveLength(3);
  });

  it("is cleaned in the way that cleanDescription does", () => {
    const result = parseLayoutAnswer(withDescription("One.\nTwo. Three."), items);

    expect(result.ok && result.description).toBe("One. Two.");
  });

  it("is not there at all, not even as undefined, when the answer has none", () => {
    const result = parseLayoutAnswer(good, items);

    expect(result.ok).toBe(true);
    expect(result.ok && "description" in result).toBe(false);
  });

  it.each([[""], ["   "], [null], [7], [{ text: "no" }], [["a"]], ["x".repeat(400)]])("is left out, and the answer is still used, when it is %j", (description) => {
    const result = parseLayoutAnswer(withDescription(description), items);

    expect(result.ok).toBe(true);
    expect(result.ok && "description" in result).toBe(false);
    expect(result.ok && result.poses).toHaveLength(3);
  });

  it("does not make an answer that has everything else wrong any better", () => {
    expect(parseLayoutAnswer(JSON.stringify({ description: "Fine.", pieces: [] }), items).ok).toBe(false);
  });
});
