import { SRGBColorSpace } from "three";
import { describe, expect, it } from "vitest";
import answers from "./ai-colour-answers.json";
import { resolveColour } from "./colour";

const hexOf = (text: string) => resolveColour(text)?.getHexString();

/** The colour of a text, as hue in degrees (0 to 360), saturation and lightness (0 to 1). */
function hsl(text: string) {
  const colour = resolveColour(text);
  if (!colour) throw new Error(`"${text}" should name a colour`);
  const { h, s, l } = colour.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
  return { hue: h * 360, s, l };
}

/** How far apart two hues are, in degrees, going the short way round the colour circle. */
const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe("resolveColour: the colour words the AI uses (AC1)", () => {
  // The hue each colour name should have, in degrees, and how far a colour may be from it and still be that colour.
  it.each([
    ["red", 0, 15],
    ["orange", 26, 12],
    ["yellow", 48, 10],
    ["green", 123, 25],
    ["teal", 180, 12],
    ["blue", 214, 12],
    ["purple", 267, 15],
    ["pink", 345, 12],
    ["brown", 22, 10],
    ["magenta", 320, 15],
    ["turquoise", 175, 12],
    ["burgundy", 345, 12],
  ])("%s has the hue of %s", (name, centre, tolerance) => {
    const { hue, s } = hsl(name);

    expect(apart(hue, centre), `${name}: hue ${hue.toFixed(0)}`).toBeLessThanOrEqual(tolerance);
    expect(s, `${name} is a colour, not a grey`).toBeGreaterThan(0.2);
  });

  it("reads white as very light, black as very dark, and grey as a grey in the middle", () => {
    expect(hsl("white").l).toBeGreaterThan(0.85);
    expect(hsl("black").l).toBeLessThan(0.2);
    expect(hsl("grey").s).toBeLessThan(0.05);
    expect(hsl("grey").l).toBeGreaterThan(0.45);
    expect(hsl("grey").l).toBeLessThan(0.65);
  });

  it("is not as strong as the pure colours of a screen, which would glare in the room", () => {
    expect(hexOf("white")).not.toBe("ffffff");
    expect(hexOf("red")).not.toBe("ff0000");
    expect(hexOf("black")).not.toBe("000000");
  });

  it("reads cream and beige as light and warm, and gold as a darker yellow", () => {
    for (const name of ["cream", "beige"]) {
      expect(hsl(name).l, name).toBeGreaterThan(0.7);
      expect(apart(hsl(name).hue, 40), name).toBeLessThan(15);
    }
    expect(apart(hsl("gold").hue, 45)).toBeLessThan(10);
    expect(hsl("gold").l).toBeLessThan(hsl("yellow").l);
  });

  it("reads the woods as the browns and tans of wood", () => {
    for (const name of ["wood", "oak", "walnut", "pine", "teak"]) {
      const { hue, l } = hsl(name);
      expect(apart(hue, 30), name).toBeLessThan(15);
      expect(l, name).toBeGreaterThan(0.2);
      expect(l, name).toBeLessThan(0.75);
    }
    expect(hsl("walnut").l).toBeLessThan(hsl("oak").l);
  });

  it("gives a new colour object each time, so that one use cannot change the next", () => {
    const first = resolveColour("red");
    first?.set(0x000000);

    expect(hexOf("red")).toBe("b8322d");
  });
});

describe("resolveColour: spelling", () => {
  it("does not mind capitals, extra spaces, underscores or hyphens", () => {
    expect(hexOf("  Dark   GREY ")).toBe(hexOf("dark grey"));
    expect(hexOf("stainless_steel")).toBe(hexOf("stainless steel"));
    expect(hexOf("off-white")).toBe(hexOf("off white"));
    expect(hexOf("light-brown")).toBe(hexOf("light brown"));
  });

  it("reads both spellings of grey", () => {
    expect(hexOf("gray")).toBe(hexOf("grey"));
    expect(hexOf("dark gray")).toBe(hexOf("dark grey"));
  });

  it("reads words like reddish and bluish as the colour", () => {
    expect(hexOf("reddish")).toBe(hexOf("red"));
    expect(hexOf("bluish")).toBe(hexOf("blue"));
    expect(hexOf("yellowish")).toBe(hexOf("yellow"));
    expect(hexOf("greyish")).toBe(hexOf("grey"));
    expect(hexOf("whitish")).toBe(hexOf("white"));
  });

  it("does not take a word that only ends like one for a colour", () => {
    expect(resolveColour("ish")).toBeNull();
    expect(resolveColour("foolish")).toBeNull();
    expect(resolveColour("stylish")).toBeNull();
    // Only "ish" makes a colour of a word: the first three letters of these are not a reason to.
    expect(resolveColour("tanner")).toBeNull();
    expect(resolveColour("pinkest")).toBeNull();
  });
});

describe("resolveColour: words that make a colour lighter, darker, duller or stronger", () => {
  it.each(["grey", "brown", "blue", "red", "green"])("dark %s is darker than %s, and light %s is lighter", (name) => {
    expect(hsl(`dark ${name}`).l).toBeLessThan(hsl(name).l);
    expect(hsl(`light ${name}`).l).toBeGreaterThan(hsl(name).l);
    expect(apart(hsl(`dark ${name}`).hue, hsl(name).hue), "the colour stays the same colour").toBeLessThan(2);
  });

  it("makes pale and pastel colours lighter and softer", () => {
    for (const word of ["pale", "pastel"]) {
      expect(hsl(`${word} blue`).l).toBeGreaterThan(hsl("blue").l + 0.05);
      expect(hsl(`${word} blue`).s).toBeLessThan(hsl("blue").s - 0.05);
    }
    expect(hsl("soft pink").l).toBeGreaterThan(hsl("pink").l + 0.03);
    expect(hsl("soft pink").s).toBeLessThan(hsl("pink").s - 0.03);
  });

  it("makes bright and vivid colours stronger, and keeps one that is almost as strong as can be a valid colour", () => {
    for (const word of ["bright", "vivid"]) {
      expect(hsl(`${word} red`).s).toBeGreaterThan(hsl("red").s + 0.05);
      expect(hsl(`${word} tangerine`).s).toBeLessThanOrEqual(1);
    }
    expect(hsl("deep red").s).toBeGreaterThan(hsl("red").s);
    expect(hsl("deep red").l).toBeLessThan(hsl("red").l);
  });

  it("makes muted, dusty, dull and faded colours greyer, and no lighter or darker", () => {
    for (const word of ["muted", "dusty", "dull", "faded"]) {
      expect(hsl(`${word} pink`).s, word).toBeLessThan(hsl("pink").s);
      expect(hsl(`${word} pink`).l, word).toBeCloseTo(hsl("pink").l, 1);
    }
  });

  it("applies them to a colour that is not the first word, and in whatever order", () => {
    expect(hexOf("brown dark")).toBe(hexOf("dark brown"));
    expect(hexOf("dark muted green")).not.toBe(hexOf("dark green"));
    expect(hexOf("dark muted green")).toBe(hexOf("muted dark green"));
  });

  it("ignores words that describe a colour without changing it", () => {
    expect(hexOf("medium brown")).toBe(hexOf("brown"));
    expect(hexOf("warm grey")).toBe(hexOf("grey"));
    expect(hexOf("very dark brown")).toBe(hexOf("dark brown"));
    expect(hexOf("natural oak")).toBe(hexOf("oak"));
  });

  it("does not make anything of a modifier with no colour to change", () => {
    expect(resolveColour("dark")).toBeNull();
    expect(resolveColour("very light")).toBeNull();
    expect(resolveColour("pale")).toBeNull();
  });
});

describe("resolveColour: more than one colour word", () => {
  it("makes the last word the colour and the ones before it a tint: blue grey is a bluish grey, grey blue a greyish blue", () => {
    const bluish = hsl("blue grey");
    const greyish = hsl("grey blue");

    expect(bluish.s).toBeGreaterThan(hsl("grey").s);
    expect(bluish.s).toBeLessThan(hsl("blue").s);
    expect(apart(bluish.hue, hsl("blue").hue)).toBeLessThan(10);
    expect(greyish.s).toBeGreaterThan(bluish.s);
  });

  it("reads oak brown as a brown between oak and plain brown, and reddish brown as a brown that leans red", () => {
    expect(hsl("oak brown").l).toBeGreaterThan(hsl("brown").l);
    expect(hsl("oak brown").l).toBeLessThan(hsl("oak").l);
    expect(hsl("reddish brown").hue).toBeLessThan(hsl("brown").hue);
    expect(hsl("reddish brown").hue).toBeGreaterThan(hsl("red").hue);
  });

  it("reads yellow-green between yellow and green, and teal blue between teal and blue", () => {
    expect(hsl("yellow-green").hue).toBeGreaterThan(hsl("yellow").hue);
    expect(hsl("yellow-green").hue).toBeLessThan(hsl("green").hue);
    expect(hsl("teal blue").hue).toBeGreaterThan(hsl("teal").hue);
    expect(hsl("teal blue").hue).toBeLessThan(hsl("blue").hue);
  });

  it("reads a name of two words that means one colour as that colour", () => {
    expect(hexOf("navy blue")).toBe(hexOf("navy"));
    expect(hsl("navy blue").l).toBeLessThan(hsl("blue").l);
    expect(hsl("sky blue").l).toBeGreaterThan(hsl("blue").l);
    expect(hsl("forest green").l).toBeLessThan(hsl("green").l);
    expect(hsl("burnt orange").l).toBeLessThan(hsl("orange").l);
    expect(hsl("hot pink").s).toBeGreaterThan(hsl("pink").s);
    expect(hsl("off white").l).toBeLessThan(hsl("white").l);
    expect(hsl("off white").l).toBeGreaterThan(0.85);
    expect(hexOf("dark navy blue")).not.toBe(hexOf("navy blue"));
    expect(hsl("dark navy blue").l).toBeLessThan(hsl("navy blue").l);
  });

  it("finds a name of two words wherever it is in the text", () => {
    expect(hexOf("a dark navy blue")).toBe(hexOf("dark navy blue"));
    expect(hexOf("royal blue chair")).toBe(hexOf("royal blue"));
  });
});

describe("resolveColour: only the main colour counts", () => {
  it.each([
    ["white with red cushions", "white"],
    ["dark blue and light wood", "dark blue"],
    ["black/white", "black"],
    ["grey, brown", "grey"],
    ["yellow (tablecloth)", "yellow"],
    ["green & white", "green"],
    ["red + blue", "red"],
    ["blue on white", "blue"],
    ["gold over silver", "gold"],
    ["green plus cream", "green"],
    ["beige; brown", "beige"],
    ["white/green", "white"],
    ["grey/white/brown", "grey"],
    ["oak brown and dark brown", "oak brown"],
    ["yellow with white polka dots (tablecloth)", "yellow"],
  ])("%s is %s", (text, main) => {
    expect(hexOf(text)).toBe(hexOf(main));
  });

  it("does not take the letters of a colour for the word 'on', 'and' or 'with'", () => {
    // "salmon" holds "on", "sand" holds "and", "bonsai" holds "on"
    expect(resolveColour("salmon")).not.toBeNull();
    expect(resolveColour("sand")).not.toBeNull();
    expect(hexOf("sand and white")).toBe(hexOf("sand"));
    expect(hexOf("salmon pink")).not.toBeNull();
    expect(resolveColour("bonsai")).toBeNull();
  });

  it("looks at the next part when the first names no colour", () => {
    expect(hexOf("framed mirror, gold")).toBe(hexOf("gold"));
    expect(hexOf("tablecloth (yellow)")).toBe(hexOf("yellow"));
  });

  it("ignores words that are not colours and patterns, when a colour is there", () => {
    expect(hexOf("patterned brown")).toBe(hexOf("brown"));
    expect(hexOf("beige striped")).toBe(hexOf("beige"));
    expect(hexOf("green floral tablecloth")).toBe(hexOf("green"));
    expect(hexOf("blue glowing")).toBe(hexOf("blue"));
    expect(hexOf("tan woven")).toBe(hexOf("tan"));
    expect(hexOf("white marble")).toBe(hexOf("white"));
  });
});

describe("resolveColour: what a piece is made of, when the colour is not named", () => {
  it("reads wood as a wood colour, and light or dark wood as a lighter or darker one", () => {
    expect(hsl("light wood").l).toBeGreaterThan(hsl("wood").l);
    expect(hsl("dark wood").l).toBeLessThan(hsl("wood").l);
    expect(apart(hsl("wood").hue, 30)).toBeLessThan(15);
    expect(hexOf("wooden")).toBe(hexOf("wood"));
  });

  it("reads metal as a grey, glass as pale and clear glass the same", () => {
    expect(hsl("metal").s).toBeLessThan(0.1);
    expect(hsl("glass").l).toBeGreaterThan(0.8);
    for (const word of ["clear", "transparent", "clear glass", "crystal", "frosted"]) {
      expect(hsl(word).l, word).toBeGreaterThan(0.8);
    }
    expect(hexOf("clear glass")).toBe(hexOf("glass"));
  });

  it("reads wicker, brick and stone as what they usually look like", () => {
    expect(apart(hsl("wicker").hue, 38)).toBeLessThan(15);
    expect(hsl("brick").hue).toBeLessThan(20);
    expect(hsl("stone").s).toBeLessThan(0.15);
    expect(hsl("marble").l).toBeGreaterThan(0.85);
    expect(resolveColour("cardboard")).not.toBeNull();
  });

  it("lets a colour that is named win over the material: black metal is black, brown wicker is brown", () => {
    expect(hexOf("black metal")).toBe(hexOf("black"));
    expect(hexOf("white wood")).toBe(hexOf("white"));
    expect(hexOf("brown wicker")).toBe(hexOf("brown"));
    expect(hexOf("red brick")).toBe(hexOf("red"));
    expect(hexOf("brick red")).toBe(hexOf("red"));
    expect(hexOf("grey stone")).toBe(hexOf("grey"));
    expect(hexOf("silver metal and glass")).toBe(hexOf("silver"));
    expect(hexOf("black with wood frame")).toBe(hexOf("black"));
    expect(hexOf("brown leather")).toBe(hexOf("brown"));
    expect(hexOf("medium brown wood")).toBe(hexOf("brown"));
  });

  it("does not count a wood that is a tone, like oak or walnut, as a mere material", () => {
    expect(hexOf("walnut brown")).not.toBe(hexOf("brown"));
    expect(hexOf("oak brown")).not.toBe(hexOf("brown"));
    expect(hexOf("light oak wood")).toBe(hexOf("light oak"));
  });
});

describe("resolveColour: a colour written as a code", () => {
  it("reads #rrggbb and #rgb exactly, in any case", () => {
    expect(hexOf("#ff0000")).toBe("ff0000");
    expect(hexOf("#F00")).toBe("ff0000");
    expect(hexOf("  #00FF7f  ")).toBe("00ff7f");
    expect(hexOf("#123")).toBe("112233");
  });

  it("does not read what is not a code", () => {
    for (const text of ["#ff00", "#gg0000", "#1234567", "ff0000", "#", "# ff0000", "rgb(255, 0, 0)"]) {
      expect(resolveColour(text), text).toBeNull();
    }
  });
});

describe("resolveColour: no colour at all (AC2)", () => {
  it.each([
    "",
    "   ",
    "unknown",
    "Unknown",
    "n/a",
    "none",
    "multicolor",
    "multi-color",
    "multicolored",
    "multicolor striped",
    "framed mirror",
    "bonsai tree",
    "patterned",
    "????",
    "123",
    "🙂",
    "wéirdö",
  ])("says there is none in %j", (text) => {
    expect(resolveColour(text)).toBeNull();
  });

  it("does not take the names of things in an object for colours", () => {
    for (const text of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "prototype", "dark constructor"]) {
      expect(() => resolveColour(text), text).not.toThrow();
      expect(resolveColour(text), text).toBeNull();
    }
  });

  it("answers null for what is not text, instead of failing", () => {
    for (const value of [undefined, null, 42, true, {}, [], ["red"], () => "red"]) {
      expect(resolveColour(value)).toBeNull();
    }
  });

  it("reads only the start of a long text, so a text that is not a colour name costs next to nothing", () => {
    expect(hexOf(`red ${"x".repeat(1_000_000)}`)).toBe(hexOf("red"));
    expect(resolveColour("x".repeat(1_000_000))).toBeNull();
    expect(resolveColour(`a${" ".repeat(100_000)}b`)).toBeNull();
    // A colour that comes after the first 80 characters is not read.
    expect(resolveColour(`${"x".repeat(100)} red`)).toBeNull();
  });
});

describe("resolveColour: the answers the AI really gave", () => {
  // Gemini, Claude and GPT-5 described the furniture in 890 photos; these are the 180 different colours they wrote.
  const NO_COLOUR = ["multicolor", "multi-color", "multicolored", "multicolor striped"];

  it("has them all", () => {
    expect(answers.length).toBe(180);
    expect(new Set(answers).size).toBe(180);
  });

  it("reads every one that names a colour, and none of them fails", () => {
    for (const answer of answers) {
      const colour = resolveColour(answer);
      if (NO_COLOUR.includes(answer)) {
        expect(colour, answer).toBeNull();
        continue;
      }
      expect(colour, answer).not.toBeNull();
      for (const channel of [colour!.r, colour!.g, colour!.b]) {
        expect(Number.isFinite(channel), answer).toBe(true);
        expect(channel, answer).toBeGreaterThanOrEqual(0);
        expect(channel, answer).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gets the commonest of them right: white, black, dark brown, oak brown, brown, cream, beige, grey and its shades", () => {
    expect(hsl("white").l).toBeGreaterThan(0.85);
    expect(hsl("black").l).toBeLessThan(0.2);
    expect(hsl("dark brown").l).toBeLessThan(hsl("brown").l);
    expect(apart(hsl("dark brown").hue, 22)).toBeLessThan(10);
    expect(apart(hsl("oak brown").hue, 28)).toBeLessThan(10);
    expect(hsl("light grey").l).toBeGreaterThan(hsl("grey").l);
    expect(hsl("dark grey").l).toBeLessThan(hsl("grey").l);
    expect(hsl("light brown").l).toBeGreaterThan(0.5);
    expect(hsl("light brown").l).toBeLessThan(0.75);
  });

  it("gets the compound answers right", () => {
    expect(hexOf("stainless steel")).toBe(hexOf("steel"));
    expect(hexOf("white/brown")).toBe(hexOf("white"));
    expect(hexOf("dark blue and light wood")).toBe(hexOf("dark blue"));
    expect(hexOf("light wood tone")).toBe(hexOf("light wood"));
    expect(hexOf("olive green")).not.toBe(hexOf("green"));
    expect(apart(hsl("olive green").hue, hsl("green").hue)).toBeLessThan(25);
    expect(apart(hsl("mustard yellow").hue, hsl("yellow").hue)).toBeLessThan(10);
    expect(apart(hsl("rust orange").hue, hsl("orange").hue)).toBeLessThan(10);
    expect(apart(hsl("sage green").hue, hsl("green").hue)).toBeLessThan(25);
  });
});
