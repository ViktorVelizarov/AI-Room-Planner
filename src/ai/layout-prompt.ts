import { formatMetres } from "../shared/room";
import { floorCoverage } from "../shared/layout";
import { MIN_MOVE_M, STYLE_NAMES, type LayoutStyle, type MadeLayout } from "../shared/layout-styles";
import type { RoomDescription } from "../shared/room-description";
import type { LayoutOptions } from "./types";

// The wording of the research notes (docs/overlap-avoidance.md, "For US-19"), with the rotation
// rule of src/shared/footprint.ts, and how a designer would arrange the 15 types of furniture. The
// answer is checked and fixed in code, so none of this has to be followed to the centimetre; it is
// there to make the answers good and the fixing rare.

/** How far a piece is from a wall that it stands against, in metres, as the prompt asks for it. */
const WALL_M = 0.02;

const INTRO = `You are an interior designer. Arrange the pieces of furniture listed below in a room and say where each one goes. A program draws the result in 3D, so the numbers must be exact.`;

const RULES = `THE RULES (the program checks them)
1. Every piece is completely inside the room, and no two pieces overlap. The footprint of a piece is a rectangle: its width x depth, turned by its rotation. The one exception is a rug: other pieces may stand on it.
2. Leave at least 10 cm between two pieces. A piece may stand against a wall, with its footprint 2 cm from the wall.
3. Use exactly the pieces of the list, each once, with the same number and type. Do not add a piece and do not leave one out.`;

const ARRANGING = `HOW TO ARRANGE THEM
- Put big pieces against the walls, with their backs to the wall and their fronts towards the room: the head of a bed, a sofa, a dresser, a bookshelf, a TV stand, a desk.
- Living area: the sofa faces the TV stand, as far from it as the room allows up to about 3 m. The coffee table is between them, about 40 cm in front of the sofa, and a side table is at the end of the sofa. An armchair is at an angle to the sofa, facing the coffee table or the TV stand. A rug lies under the coffee table and reaches under the front of the sofa and the armchairs. A floor lamp is next to a sofa or an armchair, or in a corner.
- Bedroom: the head of the bed is against a wall, and there is room to walk beside it. A nightstand is on each side of the head of the bed, facing the way the bed faces. A dresser is against another wall. A rug lies under the foot of the bed.
- Work area: the desk is against a wall, and the office chair is on its front side, turned towards the desk (the chair's rotation is the desk's plus 180 degrees).
- Dining area: the dining table is in free space, with the dining chairs round it, each turned towards the table, and a rug under the table and the chairs.
- Keep a clear path, at least 70 cm wide, to walk between the pieces and through the room. Do not push everything into one row along one wall if the room is bigger than that, and do not block the middle of the room unless the room is too small to avoid it.`;

const FRONTS = `The front of a piece is the side that people use it from: the side you sit down from on a sofa, an armchair or a chair, and the way the person sitting faces; the screen side of a TV stand; the side with the drawers or doors on a nightstand, a dresser or a desk; the open side of a bookshelf; the foot of a bed (its headboard is at the back). A table, a rug or a lamp has no front: keep it parallel to the walls.`;

/**
 * What each style asks for (US-21). The three are different ideas of the same room, so that the
 * layouts are clearly different from each other: open and along the walls, grouped and close, or a
 * work zone apart from a rest zone. They are written for a list of any furniture: a list may have no desk.
 */
const STYLE_BRIEFS: Record<LayoutStyle, string> = {
  spacious: `The room should feel open and airy. Put the pieces against the walls and in the corners, and keep the middle of the room free. Leave generous gaps: at least 90 cm for every path, and well over the minimum of 10 cm between pieces that stand near each other. Do not group the pieces in the middle of the room. A rug, if there is one, lies in the open part of the floor, with the seats at its edges.`,
  cosy: `The room should feel snug and sociable. Group the pieces close together, in one or two groups, each around a focal point such as the TV stand or a rug: the seats face each other or the focal point, a table is within arm's reach of the seats, and a lamp stands beside a seat. Keep the gaps inside a group small, 10 to 30 cm, and let a group stand away from the walls where the room allows it. The rest of the floor stays emptier.`,
  work: `The room should work well for working. Give the desk the best place, with the office chair at it, and put the bookshelf, dresser or other storage within reach of it. If the list has no desk, make the dining table, or else the biggest table, the work place, with a chair at it. Keep the work area apart from the other pieces: put the seats and the TV stand, if there are any, in another part of the room, so that the room has a work zone and a rest zone. Keep a clear path to the work place, and do not put a sofa or a TV in front of it.`,
};

const MOVE_CM = Math.round(MIN_MOVE_M * 100);

/** The rule that makes the layouts of a room differ, which the check in code (`isDifferentEnough`) holds the answer to. */
const DIFFER = `At least half of your pieces must stand in a clearly different place: at least ${MOVE_CM} cm from where the same piece stands in each of the other layouts. Turning a piece where it stands, or moving it a little, does not count, and the big pieces must not all keep the same places.`;

/** A place in metres with two decimals, and never "-0.00": a number that rounds to minus zero is written "0.00" by `toFixed`. */
const metres = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/** The style of the layout, and what it has to differ from: the layouts made at the same time (not seen), or made already (seen). */
function styleSection(style: LayoutStyle, alongside: readonly LayoutStyle[], avoid: readonly MadeLayout[]): string[] {
  const sections = [
    `THE STYLE OF THIS LAYOUT: ${STYLE_NAMES[style].toUpperCase()}\n${STYLE_BRIEFS[style]}\nLet the style show clearly, so that anyone who looks at the layout sees its idea at once. The rules above still come first.`,
  ];
  if (avoid.length > 0) {
    const made = avoid
      .map(({ style: other, poses }) => `The ${STYLE_NAMES[other]} layout puts the pieces here (piece number: x, z):\n${poses.map((pose, index) => `${index}: ${metres(pose.x_m)}, ${metres(pose.z_m)}`).join("; ")}`)
      .join("\n");
    sections.push(`LAYOUTS OF THIS ROOM THAT ARE ALREADY MADE\n${made}\n${DIFFER}`);
  } else if (alongside.length > 0) {
    const names = alongside.map((other) => STYLE_NAMES[other]).join(" and ");
    sections.push(`OTHER LAYOUTS\nThe same furniture is being arranged in this room in the ${names} ${alongside.length === 1 ? "style" : "styles"} at the same time, by someone else, so you cannot see ${alongside.length === 1 ? "that layout" : "those layouts"}. Yours must be clearly different from ${alongside.length === 1 ? "it" : "them"}.\n${DIFFER}`);
  }
  return sections;
}

/** The part of the prompt that says what is wrong with the answer that came before, when there was one. */
const retryNote = (reason: string) =>
  `YOUR PREVIOUS ANSWER COULD NOT BE USED: ${reason}\nAnswer again, from the start. Check the rules and the format before you answer.`;

/**
 * The instructions for the model: the room, the list of furniture, what to answer, the rules and
 * how to arrange it. After an answer that could not be used, `feedback` says why, so that the second
 * try can do better than the first. With a `style` the layout is asked for in that style, with a
 * description of its idea in the answer, and with what it has to differ from: the styles that are
 * made `alongside` it, which it cannot see, or the layouts that are already made (`avoid`), which it
 * is shown. It leaves out colours and materials on purpose: they say nothing about where a piece goes,
 * and free text from the user does not belong in a prompt.
 */
export function buildLayoutPrompt(
  { room, furniture }: Pick<RoomDescription, "room" | "furniture">,
  feedback?: string,
  { style, alongside = [], avoid = [] }: LayoutOptions = {},
): string {
  const width = formatMetres(room.width_m);
  const length = formatMetres(room.length_m);
  const [halfWidth, halfLength] = [formatMetres(room.width_m / 2), formatMetres(room.length_m / 2)];
  const count = furniture.length;
  const coverage = Math.round(floorCoverage({ room, furniture }) * 100);

  const list = furniture.map((item, index) => `${index}: ${item.label}, ${item.width_cm} x ${item.depth_cm} cm`).join("\n");

  // A worked example, with the numbers of this room, since the half depth of a piece is what is easiest to forget.
  const example = [
    `For example, a piece 200 cm wide and 90 cm deep, against the back wall and facing the front wall, has z_m = -${halfLength} + 0.45 + ${WALL_M} = ${formatMetres(-room.length_m / 2 + 0.45 + WALL_M)} and rotation_deg 0.`,
    `The same piece against the left wall and facing the right wall is turned 90 degrees, so it is 0.9 m across x and its middle is x_m = -${halfWidth} + 0.45 + ${WALL_M} = ${formatMetres(-room.width_m / 2 + 0.45 + WALL_M)}, with rotation_deg 90.`,
  ].join(" ");

  const sections = [
    INTRO,
    `THE ROOM (seen from above)
The room is ${width} m wide and ${length} m long. Every position is in metres from the middle of the floor, (0, 0):
- x runs across the room: -${halfWidth} is the left wall and ${halfWidth} is the right wall.
- z runs along the room: -${halfLength} is the back wall and ${halfLength} is the front wall. People look at the room from the front wall towards the back wall.
Every piece stands on the floor. The room has no doors or windows that you need to plan around.`,
    `THE FURNITURE
Each piece has a number, a type and the size of its footprint on the floor, width x depth in cm. The width is across its front and the depth is from its front to its back. The pieces cover about ${coverage}% of the floor.
${list}`,
    `WHAT TO ANSWER FOR EACH PIECE
- x_m and z_m: where the MIDDLE of the footprint of the piece is.
- rotation_deg: which way the FRONT of the piece faces. 0 faces the front wall (+z), 90 faces the right wall (+x), 180 faces the back wall (-z) and 270 faces the left wall (-x). Use these four, unless a piece is deliberately angled, for example an armchair turned 45 degrees towards a sofa. A piece turned 90 or 270 degrees has its width along z and its depth along x.
${FRONTS}
${example}`,
    RULES,
    ARRANGING,
    ...(style ? styleSection(style, alongside, avoid) : []),
    `THE ANSWER
Answer with JSON only: an object ${style ? `with a "description" (one or two plain sentences that say the idea of this layout, for the person whose room it is: no piece numbers and no coordinates) and ` : "with "}a "pieces" list of exactly ${count} ${count === 1 ? "entry, for piece 0" : `entries, one for each number from 0 to ${count - 1}`}. Each entry has "index" (the number of the piece), "label" (its type), "x_m", "z_m" and "rotation_deg". Give positions to 2 decimals.`,
  ];
  if (feedback) sections.push(retryNote(feedback));
  return sections.join("\n\n");
}
