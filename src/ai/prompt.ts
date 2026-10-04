import { FURNITURE_LABELS, MATERIALS } from "../shared/furniture";
import { UNSUPPORTED_LABEL } from "./schema";

// Based on the prompt used in the model benchmark. Changes: the 15 supported labels only,
// a material field, and an explicit width/depth convention so 3D models can be scaled
// correctly. Positions are left out on purpose: the layout step decides where items go.
export const DETECTION_PROMPT = `You are cataloging furniture in a photo of a room for a tool that places 3D models of each item into a virtual room. A later step decides where each piece goes, so do not describe positions. You only need to identify what each piece is, its real-world size, its main color and its main material, so the right 3D model can be picked and scaled correctly.

Detect every piece of furniture visible in the image, using ONLY these labels (do not invent new ones; pick the closest match, or "${UNSUPPORTED_LABEL}" if truly nothing fits):

${FURNITURE_LABELS.join(", ")}

You cannot measure exact dimensions from a single photo, so give your best estimate instead of refusing or hedging. Reason from visual cues: proportion relative to doors (~200cm tall), other furniture, or people if visible, combined with typical dimensions for that furniture category.

For each item, report:
- label: one of the values above
- width_cm, depth_cm: the item's real-world footprint, in centimeters. width_cm is its left-to-right size as seen from the front (the side people face it from); depth_cm is its front-to-back size.
- height_cm: the item's real-world height, in centimeters. For flat items like rugs, give a small nominal value (e.g. 1-2) rather than 0, since every axis needs a usable number for the 3D model.
- color: the single most dominant real-world color, as a plain color name (e.g. "oak brown", "dark grey", "cream")
- material: the item's main material, one of: ${MATERIALS.join(", ")}

List each physical piece once, even if it is partly hidden. If you are unsure whether something counts as furniture (e.g. a rug or a lamp), include it anyway rather than omitting it.
`;
