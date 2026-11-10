import { Color, Mesh, MeshStandardMaterial, SRGBColorSpace, type Material, type Object3D } from "three";
import type { FurnitureItem, Material as FurnitureMaterial } from "../shared/furniture";
import { resolveColour } from "./colour";
import { reflections } from "./reflections";

/** How a kind of material takes the light, as the 3D scene draws it. */
type Look = {
  /** From 0, a mirror, to 1, completely matt. */
  roughness: number;
  /** From 0, not a metal, to 1, a metal. */
  metalness: number;
  /** From 0, which cannot be seen, to 1, which is solid. Less than 1 lets what is behind show through. */
  opacity: number;
  /** How strongly the surroundings shine in it, from 0, not at all. The lights alone cannot make a surface look shiny. */
  reflection: number;
};

/**
 * The look of each kind of material that the AI can name. `other` has none, so a piece of it keeps
 * the model's own look. The models are flat and matt, so fabric is what they already are.
 */
const LOOKS: Record<FurnitureMaterial, Look | null> = {
  fabric: { roughness: 1, metalness: 0, opacity: 1, reflection: 0 },
  wood: { roughness: 0.6, metalness: 0, opacity: 1, reflection: 0.8 },
  leather: { roughness: 0.4, metalness: 0, opacity: 1, reflection: 1 },
  metal: { roughness: 0.25, metalness: 1, opacity: 1, reflection: 4 },
  glass: { roughness: 0.05, metalness: 0, opacity: 0.35, reflection: 1 },
  plastic: { roughness: 0.12, metalness: 0, opacity: 1, reflection: 1.5 },
  other: null,
};

/** How near in hue two colours must be to be the same colour in two shades, as a part of the colour circle. */
const SAME_HUE = 0.03;

/** Records in a model which of its materials is the main surface of the piece, by its name in the file. */
export function setMainMaterial(model: Object3D, name: string) {
  model.userData.mainMaterial = name;
}

/** The name of the main surface of a model, if it says. */
export function mainMaterialOf(model: Object3D): string | undefined {
  const name: unknown = model.userData.mainMaterial;
  return typeof name === "string" ? name : undefined;
}

/** The materials that the meshes of an object use. */
function materialsOf(root: Object3D): Set<Material> {
  const found = new Set<Material>();
  root.traverse((part) => {
    if (!(part instanceof Mesh)) return;
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) found.add(material);
  });
  return found;
}

const hslOf = (colour: Color) => colour.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);

/**
 * How much lighter (above 1) or darker (below 1) `other` is than the main material, if it is the
 * same colour in another shade, like the darker border of a rug, which then follows the main
 * colour. `null` if it is another colour, such as the legs of a sofa or the white of a pillow.
 */
function shadeOf(main: MeshStandardMaterial, other: Material): number | null {
  if (!(other instanceof MeshStandardMaterial)) return null;
  const a = hslOf(main.color);
  const b = hslOf(other.color);
  const gap = Math.abs(a.h - b.h);
  // White and greys have no hue, so they are not a shade of a colour.
  if (a.s < 0.1 || b.s < 0.1 || Math.min(gap, 1 - gap) > SAME_HUE) return null;
  return b.l / a.l;
}

/** Gives a material its colour, in the shade it is of the main surface, and its look. What is not given is left as it was. */
function paint(material: MeshStandardMaterial, colour: Color | null, shade: number, look: Look | null) {
  if (colour && shade === 1) {
    material.color.copy(colour);
  } else if (colour) {
    const { h, s, l } = hslOf(colour);
    // A lighter shade of a light colour stops at white: `setHSL` keeps the lightness within 0 to 1.
    material.color.setHSL(h, s, l * shade, SRGBColorSpace);
  }
  if (!look) return;
  material.roughness = look.roughness;
  material.metalness = look.metalness;
  material.envMap = look.reflection > 0 ? reflections() : null;
  material.envMapIntensity = look.reflection;
  material.opacity = look.opacity;
  material.transparent = look.opacity < 1;
  // A see-through piece must not hide what is behind it, nor the parts of itself that are.
  material.depthWrite = look.opacity >= 1;
}

/**
 * Gives the model of one piece of furniture the colour and the material look of the real piece:
 * its main surface is painted in the colour the AI named, and drawn in the look of the material it
 * named, so that grey fabric and oak wood look different. Only the main surface changes (`mainName`
 * is its name in the model's file); the legs of a sofa and the handles of a desk stay as they are.
 *
 * It paints a copy of the surface, so another piece made from the same model is not affected, and
 * two pieces of one type can have their own colours. A colour that cannot be read, or a material of
 * `other`, changes nothing, and neither does a model without that surface: the model keeps its own look.
 */
export function applyAppearance(piece: Object3D, item: Pick<FurnitureItem, "color" | "material">, mainName: string | undefined) {
  const colour = resolveColour(item.color);
  const look = Object.hasOwn(LOOKS, item.material) ? LOOKS[item.material] : null;
  if (!mainName || (!colour && !look)) return;

  const used = materialsOf(piece);
  const main = [...used].find((material) => material.name === mainName);
  if (!(main instanceof MeshStandardMaterial)) return;

  const painted = new Map<Material, Material>();
  for (const material of used) {
    const shade = material === main ? 1 : shadeOf(main, material);
    if (shade === null) continue;
    const copy = material.clone() as MeshStandardMaterial;
    paint(copy, colour, shade, look);
    painted.set(material, copy);
  }
  piece.traverse((part) => {
    if (!(part instanceof Mesh)) return;
    part.material = Array.isArray(part.material)
      ? part.material.map((material: Material) => painted.get(material) ?? material)
      : (painted.get(part.material) ?? part.material);
  });
}
