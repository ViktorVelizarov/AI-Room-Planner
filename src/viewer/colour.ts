import { Color, SRGBColorSpace } from "three";

/**
 * Reads the colour of a piece of furniture from the words the AI wrote for it ("dark grey", "oak
 * brown", "white with red bedding"), or that the user typed. The AI is asked for "a plain color
 * name", but it adds words, so this takes what it can read and ignores the rest.
 */

type Hsl = { h: number; s: number; l: number };
type Change = (hsl: Hsl) => Hsl;

/**
 * What the colour words stand for, as they should look on furniture under the room's lights: not as
 * strong as the pure red or white of a screen.
 */
const COLOURS = new Map(
  Object.entries({
    // whites, greys, black
    white: 0xf2f2ef, ivory: 0xefe9d6, cream: 0xefe3c6, beige: 0xd6c3a3, tan: 0xc4a679, taupe: 0xa39382,
    sand: 0xd4c19c, khaki: 0xb8aa7c, grey: 0x8c8c8c, gray: 0x8c8c8c, charcoal: 0x3f4247, slate: 0x5b6670,
    silver: 0xc3c5c9, black: 0x222222, ebony: 0x2b2321,
    // browns
    brown: 0x7a5236, chocolate: 0x523426, coffee: 0x5a3d2d, espresso: 0x3d2b21, walnut: 0x5e4130,
    mahogany: 0x63302a, chestnut: 0x7a4a30, cognac: 0x9a5b34, camel: 0xb8895a, caramel: 0xb57a3e,
    rust: 0xa4512c, terracotta: 0xb8603f,
    // woods
    oak: 0xb98d5b, pine: 0xd3ae76, birch: 0xe0cba4, maple: 0xd3a96f, ash: 0xcdb89a, beech: 0xc89d68,
    teak: 0xa8723f, cherry: 0x94472f,
    // reds, pinks, oranges, yellows
    red: 0xb8322d, crimson: 0xa31f34, scarlet: 0xc42a2a, burgundy: 0x6e1f2e, maroon: 0x6b2024, wine: 0x5e1f30,
    pink: 0xe6a1b3, rose: 0xd98aa0, magenta: 0xb0307f, fuchsia: 0xc13a8c, salmon: 0xe58c7a, coral: 0xe87a63,
    orange: 0xdf7a2e, tangerine: 0xe8832e, peach: 0xf0b999, yellow: 0xe6c540, mustard: 0xc9a227, lemon: 0xece06a,
    gold: 0xc9a23d, golden: 0xc9a23d, brass: 0xb49b45, bronze: 0x8a6a3b, copper: 0xb3694a,
    // greens
    green: 0x4d8a4f, olive: 0x7a7a3c, sage: 0x9aae8b, mint: 0xa9d9bd, emerald: 0x2b8a5e, lime: 0x9bc53d,
    // blues and purples
    blue: 0x3f70b5, navy: 0x1f2b52, denim: 0x4b6b97, teal: 0x2c8a8a, turquoise: 0x3dbab0, cyan: 0x38b6c9,
    aqua: 0x5cc5c9, purple: 0x7b50a3, violet: 0x8456b0, lavender: 0xb8a8d8, lilac: 0xc5aedb, plum: 0x6d3b63,
    indigo: 0x3d3a85,
    // metals
    steel: 0xa9b0b6, chrome: 0xd2d5d9, aluminium: 0xc2c6ca, aluminum: 0xc2c6ca, nickel: 0xa9abae, iron: 0x4f5256,
  }),
);

/**
 * What a piece is made of, with the colour that it usually has. These say little when a colour is
 * named too: "black metal" is black, and "brown wicker" is brown. They count only when no colour word does.
 */
const SURFACES = new Map(
  Object.entries({
    wood: 0xa67c52, wooden: 0xa67c52, bamboo: 0xd9c585, wicker: 0xc4a26b, rattan: 0xc9a56f, cane: 0xd6bd8b,
    jute: 0xc7ad7d, straw: 0xdcc57e, cardboard: 0xb69367, brick: 0xa0432d, stone: 0xb3ada3, marble: 0xe4e4e2,
    metal: 0xa8adb2, metallic: 0xa8adb2, glass: 0xcfe7ec, clear: 0xcfe7ec, transparent: 0xcfe7ec,
    frosted: 0xd9ecef, crystal: 0xd4eaee,
  }),
);

/** Names of two words, which mean something other than the two words do together. */
const PHRASES = new Map(
  Object.entries({
    "off white": 0xece8de, "navy blue": 0x1f2b52, "royal blue": 0x2c4fa8, "sky blue": 0x9cc6e4, "baby blue": 0xb6d4ec,
    "forest green": 0x2f5d3a, "hot pink": 0xe0408a, "burnt orange": 0xc4622d,
  }),
);

// The colour is made from what these give with `setHSL`, which keeps saturation and lightness within 0 to 1.
const lighter = (amount: number): Change => ({ h, s, l }) => ({ h, s, l: l + (1 - l) * amount });
const duller = (amount: number): Change => ({ h, s, l }) => ({ h, s: s * amount, l });
const stronger = (amount: number): Change => ({ h, s, l }) => ({ h, s: s * amount, l });

/** Words that make a colour lighter or darker, duller or stronger. */
const MODIFIERS = new Map<string, Change>([
  ["dark", ({ h, s, l }) => ({ h, s, l: l * 0.6 })],
  ["deep", ({ h, s, l }) => ({ h, s: s * 1.1, l: l * 0.8 })],
  ["light", lighter(0.4)],
  ["pale", (hsl) => duller(0.7)(lighter(0.5)(hsl))],
  ["pastel", (hsl) => duller(0.7)(lighter(0.5)(hsl))],
  ["soft", (hsl) => duller(0.8)(lighter(0.3)(hsl))],
  ["bright", stronger(1.25)],
  ["vivid", stronger(1.25)],
  ["muted", duller(0.55)],
  ["dusty", duller(0.55)],
  ["dull", duller(0.55)],
  ["faded", duller(0.55)],
]);

/** Where the AI names a second colour, or something else about the piece: the main colour is what comes before. */
const SEPARATORS = /\b(?:and|with|on|over|plus)\b|[/,&+;()]/;

/** Only this much of a text is read, so that text that is not a colour name costs next to nothing. */
const MAX_LENGTH = 80;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;

/** The colour for a word such as "reddish", which is a little red. */
function ishColour(word: string): number | undefined {
  if (!word.endsWith("ish")) return undefined;
  const stem = word.slice(0, -3);
  // "reddish" (red, with its last letter doubled), "bluish" (blue, which lost its e), "yellowish".
  return [stem, `${stem}e`, stem.slice(0, -1)].map((name) => COLOURS.get(name)).find((colour) => colour !== undefined);
}

/**
 * Several colours as one. In "blue grey" and "oak brown" the last word is the colour and the ones
 * before it tint it, so the last counts twice.
 */
function blend(hexes: number[]): Color {
  const sum = { r: 0, g: 0, b: 0 };
  let weights = 0;
  hexes.forEach((hex, index) => {
    const weight = index === hexes.length - 1 ? 2 : 1;
    const { r, g, b } = new Color().setHex(hex, SRGBColorSpace).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
    sum.r += r * weight;
    sum.g += g * weight;
    sum.b += b * weight;
    weights += weight;
  });
  return new Color().setRGB(sum.r / weights, sum.g / weights, sum.b / weights, SRGBColorSpace);
}

/** The colour of one part of the text, between separators, or null if it names none. */
function readSegment(segment: string): Color | null {
  const words = segment.split(/[^a-z]+/).filter(Boolean);
  const named: number[] = [];
  const made: number[] = [];
  const changes: Change[] = [];

  for (let i = 0; i < words.length; i++) {
    const phrase = PHRASES.get(`${words[i]} ${words[i + 1]}`);
    if (phrase !== undefined) {
      named.push(phrase);
      i++;
      continue;
    }
    const colour = COLOURS.get(words[i]) ?? ishColour(words[i]);
    const surface = SURFACES.get(words[i]);
    const change = MODIFIERS.get(words[i]);
    if (colour !== undefined) named.push(colour);
    else if (surface !== undefined) made.push(surface);
    else if (change) changes.push(change);
  }

  const found = named.length > 0 ? named : made;
  if (found.length === 0) return null;
  const colour = blend(found);
  if (changes.length === 0) return colour;

  const hsl = changes.reduce((current, change) => change(current), colour.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace));
  return colour.setHSL(hsl.h, hsl.s, hsl.l, SRGBColorSpace);
}

/**
 * The colour that `text` names, or `null` if it names none: it is missing or "unknown", or its words
 * are not colours ("framed mirror", "multicolor"). Only the main colour counts: "white with red
 * bedding" is white, and "dark blue and light wood" is dark blue. A colour can also be written as
 * "#rrggbb" or "#rgb". Never throws, whatever the text is.
 */
export function resolveColour(text: unknown): Color | null {
  if (typeof text !== "string") return null;
  const cleaned = text.slice(0, MAX_LENGTH).toLowerCase().trim();
  if (HEX.test(cleaned)) return new Color(cleaned);

  for (const segment of cleaned.split(SEPARATORS)) {
    const colour = readSegment(segment);
    if (colour) return colour;
  }
  return null;
}
