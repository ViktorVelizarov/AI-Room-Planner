import type { ModelAnswer } from "../ai/types";
import { typicalItem, type FurnitureItem, type FurnitureLabel } from "../shared/furniture";
import type { Pose } from "../shared/layout";

// A room for the tests of layouts that cannot be fixed (US-22): crowded, but not too full to be arranged,
// so that one answer can be fine and another can be past fixing in the same room.

const item = (label: FurnitureLabel, width_cm: number, depth_cm: number): FurnitureItem => ({ ...typicalItem(label), width_cm, depth_cm });

/** A small bedroom of 3 m x 2.6 m with a bed, two nightstands, a dresser, a desk and its chair: 63% of the floor, where the page warns (from 60%) and the app does not yet refuse (from 70%). */
export const crowdedRoom = {
  room: { width_m: 3, length_m: 2.6, height_m: 2.5 },
  furniture: [item("bed", 160, 200), item("nightstand", 45, 40), item("nightstand", 45, 40), item("dresser", 100, 45), item("desk", 120, 60), item("office_chair", 45, 45)],
};

const at = (x_m: number, z_m: number, rotation_deg = 0): Pose => ({ x_m, z_m, rotation_deg });

/** An arrangement of the room that is fine as it is: the bed in the back left corner, the nightstands beside and at the foot of it, the dresser on the right wall, the desk at the front wall and its chair. */
export const CROWDED_FINE: Pose[] = [at(-0.65, -0.28), at(0.4, -1.08), at(-1, 0.95), at(1.25, 0, 270), at(0.75, 1, 180), at(0.6, 0.45)];

/** The same arrangement the other way round, left to right: fine as it is too, and clearly different from the one above. */
export const CROWDED_MIRRORED: Pose[] = [at(0.65, -0.28), at(-0.4, -1.08), at(1, 0.95), at(-1.25, 0, 90), at(-0.75, 1, 180), at(-0.6, 0.45)];

/** The first arrangement turned right round, back to front and left to right: fine as it is too, and clearly different from both of the two above (five of its six pieces are in other places than in the mirrored one, and all six than in the first). */
export const CROWDED_TURNED: Pose[] = [at(0.65, 0.28, 180), at(-0.4, 1.08, 180), at(1, -0.95, 180), at(-1.25, 0, 90), at(-0.75, -1, 0), at(-0.6, -0.45, 180)];

/**
 * An answer that is nearly an arrangement, with every piece within a few decimetres of where the one above
 * has it, but that the app cannot make fine in its three attempts, although this room can hold the pieces.
 */
export const CROWDED_UNFIXABLE: Pose[] = [at(-0.31, -0.31), at(0.28, -1.4), at(-1.06, 1.09), at(1.01, 0.04, 270), at(0.53, 0.9, 180), at(1.03, 0.3)];

/** What the model answers for the pieces of this room, with an idea of the layout if there is one. */
export const crowdedAnswer = (poses: Pose[], text?: string): ModelAnswer => ({
  text: JSON.stringify({
    ...(text === undefined ? {} : { description: text }),
    pieces: poses.map((pose, index) => ({ index, label: crowdedRoom.furniture[index].label, ...pose })),
  }),
});
