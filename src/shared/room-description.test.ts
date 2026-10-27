import { describe, expect, it } from "vitest";
import { FURNITURE_LABELS, MATERIALS, typicalItem, type FurnitureItem } from "./furniture";
import { ROOM_LIMITS, parseDimension, type RoomDimension, type RoomSize } from "./room";
import {
  createRoomDescription,
  parseRoomDescription,
  roomDescriptionSchema,
  type RoomDescriptionResult,
} from "./room-description";

const room: RoomSize = { width_m: 4, length_m: 5, height_m: 2.5 };
const sofa: FurnitureItem = { label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "dark grey", material: "fabric" };
const rug: FurnitureItem = { label: "rug", width_cm: 160, depth_cm: 230, height_cm: 1, color: "beige", material: "fabric" };

/** The problems of a room description that was rejected. Fails the test if it was accepted. */
function problemsOf(result: RoomDescriptionResult): string[] {
  if (result.ok) throw new Error("expected the room description to be rejected");
  return result.problems;
}

/** The room description of a result that was accepted. Fails the test if it was rejected. */
function descriptionOf(result: RoomDescriptionResult) {
  if (!result.ok) throw new Error(`expected the room description to be accepted: ${result.problems.join(" ")}`);
  return result.description;
}

describe("creating the room description", () => {
  it("holds the room size and every piece's type, size, colour and material", () => {
    const description = descriptionOf(createRoomDescription(room, [sofa, rug]));

    expect(description).toEqual({ room, furniture: [sofa, rug] });
    expect(Object.keys(description).sort()).toEqual(["furniture", "room"]);
    expect(Object.keys(description.furniture[0]).sort()).toEqual(
      ["color", "depth_cm", "height_cm", "label", "material", "width_cm"],
    );
  });

  it("keeps the pieces in the order of the list, which is how a piece is told apart from another", () => {
    const description = descriptionOf(createRoomDescription(room, [rug, sofa, rug]));

    expect(description.furniture.map((piece) => piece.label)).toEqual(["rug", "sofa", "rug"]);
  });

  it("keeps identical pieces as separate pieces", () => {
    const chair = typicalItem("dining_chair");

    const description = descriptionOf(createRoomDescription(room, [sofa, chair, chair, chair, chair]));

    expect(description.furniture).toHaveLength(5);
  });

  it("is a snapshot: changing the list afterwards does not change the description", () => {
    const size = { ...room };
    const pieces = [{ ...sofa }];

    const description = descriptionOf(createRoomDescription(size, pieces));
    size.width_m = 10;
    pieces[0].width_cm = 999;
    pieces.push({ ...rug });

    expect(description).toEqual({ room, furniture: [sofa] });
  });

  it("leaves out anything that is not part of the description", () => {
    const description = descriptionOf(
      parseRoomDescription({
        room: { ...room, shape: "L" },
        furniture: [{ ...sofa, price: 499 }],
        note: "from a test",
      }),
    );

    expect(description).toEqual({ room, furniture: [sofa] });
  });

  it.each(FURNITURE_LABELS)("accepts %s, the way the user adds it with its typical size", (label) => {
    expect(createRoomDescription(room, [typicalItem(label)]).ok).toBe(true);
  });

  it.each(MATERIALS)("accepts %s as a material", (material) => {
    expect(createRoomDescription(room, [{ ...sofa, material }]).ok).toBe(true);
  });

  it("accepts a size the AI may give but the user could not type, such as a very thin rug", () => {
    expect(createRoomDescription(room, [{ ...rug, height_cm: 0.5 }]).ok).toBe(true);
  });

  it.each([
    ["the smallest room", { width_m: 1, length_m: 1, height_m: 2 }],
    ["the largest room", { width_m: 20, length_m: 20, height_m: 5 }],
  ])("accepts %s", (_, size) => {
    expect(createRoomDescription(size, [sofa]).ok).toBe(true);
  });
});

describe("validating the room description and loading it again", () => {
  const pieces: FurnitureItem[] = [
    sofa,
    { ...rug, height_cm: 0.5 },
    { label: "bookshelf", width_cm: 85.5, depth_cm: 30.25, height_cm: 1000, color: 'warm "oak" / сив 🛋', material: "wood" },
    typicalItem("bed"),
  ];

  it("passes validation against its schema", () => {
    const description = descriptionOf(createRoomDescription({ width_m: 3.75, length_m: 6.2, height_m: 2.4 }, pieces));

    expect(roomDescriptionSchema.safeParse(description).success).toBe(true);
    expect(parseRoomDescription(description).ok).toBe(true);
  });

  it("loads again from JSON text with nothing lost, not even the order of the fields", () => {
    const description = descriptionOf(createRoomDescription({ width_m: 3.75, length_m: 6.2, height_m: 2.4 }, pieces));
    const json = JSON.stringify(description);

    const loaded = descriptionOf(parseRoomDescription(JSON.parse(json)));

    expect(loaded).toEqual(description);
    expect(JSON.stringify(loaded)).toBe(json);
  });

  it("loads again from the indented JSON that the debug view shows", () => {
    const description = descriptionOf(createRoomDescription(room, pieces));

    const loaded = descriptionOf(parseRoomDescription(JSON.parse(JSON.stringify(description, null, 2))));

    expect(loaded).toEqual(description);
  });

  it("is a different object when loaded, so loading it does not share anything with the original", () => {
    const description = descriptionOf(createRoomDescription(room, [sofa]));

    const loaded = descriptionOf(parseRoomDescription(description));

    expect(loaded).toEqual(description);
    expect(loaded).not.toBe(description);
    expect(loaded.furniture[0]).not.toBe(description.furniture[0]);
  });

  it("uses the same room limits as the room size form", () => {
    for (const dimension of ["width", "length", "height"] as RoomDimension[]) {
      const { min, max } = ROOM_LIMITS[dimension];
      const key = `${dimension}_m` as keyof RoomSize;

      for (const metres of [min - 0.01, min, max, max + 0.01]) {
        const accepted = createRoomDescription({ ...room, [key]: metres }, [sofa]).ok;

        expect(accepted, `${dimension} ${metres} m`).toBe(parseDimension(dimension, String(metres)).ok);
      }
    }
  });
});

describe("rejecting an incomplete room description", () => {
  describe("a missing or wrong room size", () => {
    it.each([
      ["width", { length_m: 5, height_m: 2.5 }, "The room width is missing."],
      ["length", { width_m: 4, height_m: 2.5 }, "The room length is missing."],
      ["height", { width_m: 4, length_m: 5 }, "The room height is missing."],
    ])("says the %s is missing", (_, size, message) => {
      expect(problemsOf(createRoomDescription(size, [sofa]))).toEqual([message]);
    });

    it("says what is missing when every dimension is", () => {
      expect(problemsOf(createRoomDescription({}, [sofa]))).toEqual([
        "The room width is missing.",
        "The room length is missing.",
        "The room height is missing.",
      ]);
    });

    it.each([null, undefined])("says the room size is missing when there is none (%s)", (size) => {
      expect(problemsOf(createRoomDescription(size, [sofa]))).toEqual(["The room size is missing."]);
    });

    it("treats a number that is not a number (an empty field read as NaN) as missing", () => {
      expect(problemsOf(createRoomDescription({ ...room, width_m: NaN }, [sofa]))).toEqual([
        "The room width is missing.",
      ]);
    });

    it.each([
      ["width", 0.5, "The room width must be at least 1 m (it is 0.5 m)."],
      ["width", 21, "The room width must be at most 20 m (it is 21 m)."],
      ["length", 0, "The room length must be at least 1 m (it is 0 m)."],
      ["length", 25, "The room length must be at most 20 m (it is 25 m)."],
      ["height", 1.5, "The room height must be at least 2 m (it is 1.5 m)."],
      ["height", 6, "The room height must be at most 5 m (it is 6 m)."],
      ["height", -3, "The room height must be at least 2 m (it is -3 m)."],
    ] as const)("says the %s is out of range when it is %j", (dimension, metres, message) => {
      const size = { ...room, [`${dimension}_m`]: metres };

      expect(problemsOf(createRoomDescription(size, [sofa]))).toEqual([message]);
    });

    it.each([["4"], [Infinity], [true], [[4]]])("says the width must be a number when it is %j", (width) => {
      expect(problemsOf(parseRoomDescription({ room: { ...room, width_m: width }, furniture: [sofa] }))).toEqual([
        "The room width must be a number.",
      ]);
    });

    it.each([["big"], [4], [true]])("says the room size must be an object when it is %j", (size) => {
      expect(problemsOf(parseRoomDescription({ room: size, furniture: [sofa] }))).toEqual([
        "The room size must be an object with a width, a length and a height.",
      ]);
    });
  });

  describe("a missing or empty furniture list", () => {
    it("says the list is empty and what to do", () => {
      expect(problemsOf(createRoomDescription(room, []))).toEqual([
        "The furniture list is empty. Add at least one piece of furniture.",
      ]);
    });

    it.each([null, undefined])("says the list is missing (%s)", (furniture) => {
      expect(problemsOf(createRoomDescription(room, furniture))).toEqual(["The furniture list is missing."]);
    });

    it.each([["sofa"], [{}], [3]])("says the list must be a list when it is %j", (furniture) => {
      expect(problemsOf(parseRoomDescription({ room, furniture }))).toEqual([
        "The furniture list must be a list of pieces.",
      ]);
    });
  });

  describe("a piece with a missing or wrong size", () => {
    it.each([
      ["width_cm", "width"],
      ["depth_cm", "depth"],
      ["height_cm", "height"],
    ] as const)("says which size is missing: %s", (field, name) => {
      const broken = { ...sofa, [field]: undefined };

      expect(problemsOf(createRoomDescription(room, [broken]))).toEqual([
        `Furniture item 1 (Sofa): the ${name} is missing.`,
      ]);
    });

    it("says which piece it is by its number in the list and its type", () => {
      const broken = { ...typicalItem("floor_lamp"), depth_cm: undefined };

      expect(problemsOf(createRoomDescription(room, [sofa, rug, broken]))).toEqual([
        "Furniture item 3 (Floor lamp): the depth is missing.",
      ]);
    });

    it("says a size is missing when it is NaN or null", () => {
      expect(problemsOf(createRoomDescription(room, [{ ...sofa, width_cm: NaN }]))).toEqual([
        "Furniture item 1 (Sofa): the width is missing.",
      ]);
      expect(problemsOf(parseRoomDescription({ room, furniture: [{ ...sofa, height_cm: null }] }))).toEqual([
        "Furniture item 1 (Sofa): the height is missing.",
      ]);
    });

    it.each([
      [0, "Furniture item 1 (Sofa): the width must be at least 0.1 cm (it is 0 cm)."],
      [-20, "Furniture item 1 (Sofa): the width must be at least 0.1 cm (it is -20 cm)."],
      [1001, "Furniture item 1 (Sofa): the width must be at most 1000 cm (it is 1001 cm)."],
    ])("says a width of %j cm is out of range", (width, message) => {
      expect(problemsOf(createRoomDescription(room, [{ ...sofa, width_cm: width }]))).toEqual([message]);
    });

    it.each([["200"], [Infinity], [{}]])("says the size must be a number when it is %j", (width) => {
      expect(problemsOf(parseRoomDescription({ room, furniture: [{ ...sofa, width_cm: width }] }))).toEqual([
        "Furniture item 1 (Sofa): the width must be a number.",
      ]);
    });
  });

  describe("a piece with a missing colour, material or type", () => {
    it.each([[""], ["   "]])("says the colour is empty when it is %j", (color) => {
      expect(problemsOf(createRoomDescription(room, [{ ...sofa, color }]))).toEqual([
        "Furniture item 1 (Sofa): the colour is empty.",
      ]);
    });

    it("says the colour is missing, or that it must be text", () => {
      expect(problemsOf(createRoomDescription(room, [{ ...sofa, color: undefined }]))).toEqual([
        "Furniture item 1 (Sofa): the colour is missing.",
      ]);
      expect(problemsOf(parseRoomDescription({ room, furniture: [{ ...sofa, color: 7 }] }))).toEqual([
        "Furniture item 1 (Sofa): the colour must be text.",
      ]);
    });

    it("says the material is missing, or that it is not supported and which ones are", () => {
      expect(problemsOf(createRoomDescription(room, [{ ...sofa, material: undefined }]))).toEqual([
        "Furniture item 1 (Sofa): the material is missing.",
      ]);
      expect(problemsOf(parseRoomDescription({ room, furniture: [{ ...sofa, material: "velvet" }] }))).toEqual([
        'Furniture item 1 (Sofa): the material "velvet" is not supported; use one of: fabric, wood, leather, metal, glass, plastic, other.',
      ]);
    });

    it("says the type is missing, or that it is not supported and which ones are", () => {
      expect(problemsOf(createRoomDescription(room, [{ ...sofa, label: undefined }]))).toEqual([
        "Furniture item 1: the type is missing.",
      ]);

      const [message] = problemsOf(parseRoomDescription({ room, furniture: [sofa, { ...sofa, label: "chaise" }] }));
      expect(message).toMatch(/^Furniture item 2: the type "chaise" is not supported; use one of: sofa, armchair, /);
      expect(message).toContain("floor_lamp, rug.");
    });

    it("does not name a piece by a type that is not supported", () => {
      const [message] = problemsOf(parseRoomDescription({ room, furniture: [{ ...sofa, label: "constructor" }] }));

      expect(message).toMatch(/^Furniture item 1: the type "constructor" is not supported/);
    });
  });

  describe("a piece that is not a piece", () => {
    it.each([[null], [undefined]])("says the piece is missing when it is %s", (piece) => {
      expect(problemsOf(parseRoomDescription({ room, furniture: [sofa, piece] }))).toEqual([
        "Furniture item 2 is missing.",
      ]);
    });

    it.each([["sofa"], [5], [[]]])("says what a piece must be when it is %j", (piece) => {
      expect(problemsOf(parseRoomDescription({ room, furniture: [piece] }))).toEqual([
        "Furniture item 1 must be an object with a type, a size, a colour and a material.",
      ]);
    });

    it("says everything that is missing from a piece that is an empty object", () => {
      expect(problemsOf(parseRoomDescription({ room, furniture: [{}] }))).toEqual([
        "Furniture item 1: the type is missing.",
        "Furniture item 1: the width is missing.",
        "Furniture item 1: the depth is missing.",
        "Furniture item 1: the height is missing.",
        "Furniture item 1: the colour is missing.",
        "Furniture item 1: the material is missing.",
      ]);
    });
  });

  it("reports every problem at once, not only the first", () => {
    const problems = problemsOf(
      createRoomDescription({ width_m: 4, length_m: 5 }, [
        sofa,
        { ...rug, depth_cm: undefined },
        { ...sofa, color: " ", height_cm: 0 },
      ]),
    );

    expect(problems).toEqual([
      "The room height is missing.",
      "Furniture item 2 (Rug): the depth is missing.",
      "Furniture item 3 (Sofa): the height must be at least 0.1 cm (it is 0 cm).",
      "Furniture item 3 (Sofa): the colour is empty.",
    ]);
  });

  it("reports a missing size and an empty list together", () => {
    expect(problemsOf(createRoomDescription({ width_m: 4, length_m: 5 }, []))).toEqual([
      "The room height is missing.",
      "The furniture list is empty. Add at least one piece of furniture.",
    ]);
  });

  describe("input that is not a room description at all", () => {
    it.each([[null], [undefined]])("says there is none when it is %s", (input) => {
      expect(problemsOf(parseRoomDescription(input))).toEqual(["There is no room description."]);
    });

    it.each([["text"], [42], [true], [[]]])("says what it must be when it is %j", (input) => {
      expect(problemsOf(parseRoomDescription(input))).toEqual([
        "A room description must be an object with a room size and a furniture list.",
      ]);
    });

    it("says that both the room size and the furniture list are missing from an empty object", () => {
      expect(problemsOf(parseRoomDescription({}))).toEqual([
        "The room size is missing.",
        "The furniture list is missing.",
      ]);
    });
  });

  it("does not throw on unusual values, only reports them", () => {
    const odd = {
      room: { width_m: BigInt(10), length_m: Symbol("length"), height_m: () => 2 },
      furniture: [
        { label: Symbol("label"), width_cm: BigInt(1), depth_cm: new Date(), height_cm: new Map(), color: Symbol("color"), material: BigInt(1) },
        Object.create(null),
        () => 1,
      ],
    };

    for (const input of [BigInt(10), Symbol("x"), () => 1, new Date(), new Map(), Object.create(null), odd]) {
      const problems = problemsOf(parseRoomDescription(input));

      expect(problems.length).toBeGreaterThan(0);
      expect(problems.every((problem) => typeof problem === "string" && problem !== "")).toBe(true);
    }
  });

  it("never lets the library's own wording through: every message is a plain sentence", () => {
    const bad: unknown[] = [
      null,
      "x",
      {},
      { room: null, furniture: null },
      { room: { width_m: "4", length_m: NaN, height_m: -1 }, furniture: "sofa" },
      { room, furniture: [null, 3, {}, { ...sofa, label: 4, color: 1, material: {}, width_cm: [] }] },
      { room, furniture: [] },
    ];

    for (const input of bad) {
      for (const problem of problemsOf(parseRoomDescription(input))) {
        expect(problem).toMatch(/^[A-Z].*\.$/);
        expect(problem).not.toMatch(/Invalid|Too small|Too big|expected|received|undefined|NaN|\[object/);
      }
    }
  });
});
