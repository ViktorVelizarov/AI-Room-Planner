import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, type Material, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { FURNITURE_LABELS, MATERIALS, type FurnitureItem, type FurnitureLabel } from "../shared/furniture";
import { applyAppearance, mainMaterialOf, setMainMaterial } from "./appearance";
import { resolveColour } from "./colour";
import { modelFor, parseFurnitureModel } from "./furniture-library";
import { reflections } from "./reflections";

type Kind = FurnitureItem["material"];

/** The real model of a type, read from the library folder. */
async function modelOf(type: FurnitureLabel): Promise<Group> {
  const bytes = readFileSync(join(process.cwd(), "public", "models", modelFor(type).file));
  return parseFurnitureModel(modelFor(type), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const materialsIn = (mesh: Mesh): Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

/** The materials of an object by their names. */
function surfaces(root: Object3D): Map<string, MeshStandardMaterial> {
  const found = new Map<string, MeshStandardMaterial>();
  root.traverse((part) => {
    if (part instanceof Mesh) for (const material of materialsIn(part)) found.set(material.name, material as MeshStandardMaterial);
  });
  return found;
}

/** Every material of an object, one for each mesh, in order. */
function allMaterials(root: Object3D): Material[] {
  const found: Material[] = [];
  root.traverse((part) => part instanceof Mesh && found.push(...materialsIn(part)));
  return found;
}

const hexOf = (material: { color: Color }) => material.color.getHexString();
const hslOf = (colour: Color) => colour.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
const item = (color: string, material: Kind) => ({ color, material });

/** A piece made from a model the way the scene does it: a copy that shares the model's materials until it is painted. */
async function pieceOf(type: FurnitureLabel, wanted: Pick<FurnitureItem, "color" | "material">) {
  const model = await modelOf(type);
  const piece = model.clone(true);
  applyAppearance(piece, wanted, mainMaterialOf(model));
  return { model, piece };
}

/** The main surface of a sofa that is painted as given. */
async function sofaSurface(material: Kind, color = "grey") {
  const { piece } = await pieceOf("sofa", item(color, material));
  return surfaces(piece).get("carpet")!;
}

/** A made-up surface, and a model made of surfaces, for what the library does not have. */
function surface(name: string, color: number | string | Color) {
  const made = new MeshStandardMaterial({ color });
  made.name = name;
  return made;
}
function madeOf(...materials: Material[]) {
  const group = new Group();
  for (const material of materials) group.add(new Mesh(new BoxGeometry(1, 1, 1), material));
  return group;
}

describe("applyAppearance: a piece takes the colour and the look of the real piece (AC1)", () => {
  it("paints the main surface in the colour the AI named, exactly", async () => {
    for (const color of ["dark grey", "oak brown", "navy blue", "#3a7bd5"]) {
      const { piece } = await pieceOf("sofa", item(color, "fabric"));

      expect(surfaces(piece).get("carpet")!.color.toArray(), color).toEqual(resolveColour(color)!.toArray());
    }
  });

  it("paints it the same way for each colour, so that different colours are different", async () => {
    const hexes = new Set<string>();
    for (const color of ["white", "black", "red", "blue", "green", "oak brown", "beige", "navy blue"]) {
      hexes.add(hexOf(await sofaSurface("fabric", color)));
    }

    expect(hexes.size).toBe(8);
  });

  it.each(FURNITURE_LABELS)("%s: paints the main surface, and leaves the rest of the model as it is", async (type) => {
    const { model, piece } = await pieceOf(type, item("red", "leather"));
    const before = surfaces(model);
    const after = surfaces(piece);
    const painted = [...after.keys()].filter((name) => after.get(name) !== before.get(name));

    // The border of a rug is a shade of its main colour, so it follows; nothing else does.
    expect(painted.sort()).toEqual(type === "rug" ? ["carpet", "carpetDarker"] : [mainMaterialOf(model)]);
    expect(hexOf(after.get(mainMaterialOf(model)!)!)).toBe(resolveColour("red")!.getHexString());
    for (const name of before.keys()) {
      if (!painted.includes(name)) expect(after.get(name), `${type}: ${name}`).toBe(before.get(name));
    }
  });

  it("does not change the model that the piece was copied from, so that another piece of its type is not affected", async () => {
    const { model } = await pieceOf("sofa", item("red", "metal"));
    const untouched = await modelOf("sofa");

    const [now, before] = [surfaces(model).get("carpet")!, surfaces(untouched).get("carpet")!];
    expect(hexOf(now)).toBe(hexOf(before));
    expect(now.metalness).toBe(before.metalness);
    expect(now.roughness).toBe(before.roughness);
    expect(now.envMap).toBeNull();
  });

  it("keeps the shape of the model: the geometry is shared, not copied", async () => {
    const { model, piece } = await pieceOf("sofa", item("red", "leather"));
    const geometries = (root: Object3D) => {
      const found: unknown[] = [];
      root.traverse((part) => part instanceof Mesh && found.push(part.geometry));
      return found;
    };

    expect(geometries(piece)).toEqual(geometries(model));
    geometries(piece).forEach((geometry, index) => expect(geometry).toBe(geometries(model)[index]));
  });
});

describe("applyAppearance: the look of each kind of material (AC1)", () => {
  const KINDS = MATERIALS.filter((kind) => kind !== "other");

  it("makes fabric completely matt: no shine, no metal, solid", async () => {
    const fabric = await sofaSurface("fabric");

    expect(fabric.roughness).toBe(1);
    expect(fabric.metalness).toBe(0);
    expect(fabric.opacity).toBe(1);
    expect(fabric.transparent).toBe(false);
    expect(fabric.envMap).toBeNull();
  });

  it("makes metal, and only metal, a metal", async () => {
    expect((await sofaSurface("metal")).metalness).toBeGreaterThanOrEqual(0.9);
    for (const kind of KINDS.filter((other) => other !== "metal")) expect((await sofaSurface(kind)).metalness, kind).toBe(0);
  });

  it("makes glass, and only glass, see-through, so that what is behind it shows and it does not hide itself", async () => {
    const glass = await sofaSurface("glass");

    expect(glass.transparent).toBe(true);
    // See-through, but still there to be seen.
    expect(glass.opacity).toBeGreaterThan(0.2);
    expect(glass.opacity).toBeLessThan(0.6);
    expect(glass.depthWrite).toBe(false);
    for (const kind of KINDS.filter((other) => other !== "glass")) {
      const solid = await sofaSurface(kind);
      expect(solid.transparent, kind).toBe(false);
      expect(solid.opacity, kind).toBe(1);
      expect(solid.depthWrite, kind).toBe(true);
    }
  });

  it("makes the materials shinier in this order: fabric, wood, leather, plastic", async () => {
    const roughness = [];
    for (const kind of ["fabric", "wood", "leather", "plastic"] as const) roughness.push((await sofaSurface(kind)).roughness);

    expect(roughness).toEqual([...roughness].sort((a, b) => b - a));
    expect(new Set(roughness).size).toBe(4);
  });

  it("lets everything but fabric reflect the room, and fabric not", async () => {
    for (const kind of KINDS) {
      const surfaceOfKind = await sofaSurface(kind);
      if (kind === "fabric") {
        expect(surfaceOfKind.envMap).toBeNull();
      } else {
        expect(surfaceOfKind.envMap, kind).toBe(reflections());
        expect(surfaceOfKind.envMapIntensity, kind).toBeGreaterThan(0);
      }
    }
  });

  it("lets a metal reflect the room the most, since it has no colour of its own to show but what it reflects, and wood the least", async () => {
    const strength = async (kind: Kind) => (await sofaSurface(kind)).envMapIntensity;

    expect(await strength("metal")).toBeGreaterThan(await strength("plastic"));
    expect(await strength("metal")).toBeGreaterThan(await strength("leather"));
    expect(await strength("wood")).toBeLessThan(await strength("leather"));
    expect(await strength("fabric")).toBe(0);
  });

  it("gives each kind of material a look that is not the look of any other", async () => {
    const looks = new Set<string>();
    for (const kind of KINDS) {
      const { roughness, metalness, opacity, envMapIntensity } = await sofaSurface(kind);
      looks.add(JSON.stringify([roughness, metalness, opacity, envMapIntensity]));
    }

    expect(looks.size).toBe(KINDS.length);
  });

  it("gives a kind of material the same look whatever its colour", async () => {
    const red = await sofaSurface("leather", "red");
    const blue = await sofaSurface("leather", "blue");

    expect([red.roughness, red.metalness, red.opacity, red.envMapIntensity]).toEqual([blue.roughness, blue.metalness, blue.opacity, blue.envMapIntensity]);
    expect(hexOf(red)).not.toBe(hexOf(blue));
  });

  it("gives the look to every surface that follows the main colour, as well as to the main one", async () => {
    const { piece } = await pieceOf("rug", item("beige", "leather"));
    const [main, border] = [surfaces(piece).get("carpet")!, surfaces(piece).get("carpetDarker")!];

    expect(border.roughness).toBe(main.roughness);
    expect(border.metalness).toBe(main.metalness);
    expect(border.envMap).toBe(main.envMap);
  });

  it("gives a material of `other` no look of its own: the model's, with the colour that was named", async () => {
    const model = await modelOf("sofa");
    const other = await sofaSurface("other", "red");
    const original = surfaces(model).get("carpet")!;

    expect(hexOf(other)).toBe(resolveColour("red")!.getHexString());
    expect(other.roughness).toBe(original.roughness);
    expect(other.metalness).toBe(original.metalness);
    expect(other.envMap).toBeNull();
    expect(other.transparent).toBe(false);
  });
});

describe("applyAppearance: a colour or material that is missing or unknown changes nothing (AC2)", () => {
  /** Whether a piece uses the very same materials as the model it was copied from, mesh by mesh. */
  const sameMaterials = (model: Object3D, piece: Object3D) => {
    const [a, b] = [allMaterials(model), allMaterials(piece)];
    return a.length === b.length && a.every((material, index) => material === b[index]);
  };

  it("keeps every material of the model when both are unknown, so that its own look is used", async () => {
    const { model, piece } = await pieceOf("sofa", item("unknown", "other"));

    expect(allMaterials(piece).length).toBeGreaterThan(1);
    expect(sameMaterials(model, piece)).toBe(true);
  });

  it.each(["unknown", "Unknown", "", "   ", "multicolor", "framed mirror", "dark", "????"])(
    "keeps the model's own look for the colour %j when the material is unknown too",
    async (color) => {
      const { model, piece } = await pieceOf("armchair", item(color, "other"));

      expect(sameMaterials(model, piece)).toBe(true);
    },
  );

  it("keeps the colour of the model, and gives the look, when only the colour is unknown", async () => {
    const model = await modelOf("sofa");
    const leather = await sofaSurface("leather", "unknown");

    expect(hexOf(leather)).toBe(hexOf(surfaces(model).get("carpet")!));
    expect(leather.roughness).toBeLessThan(1);
  });

  it("keeps the look of the model, and gives the colour, when only the material is unknown", async () => {
    const { model, piece } = await pieceOf("sofa", item("red", "other"));

    expect(hexOf(surfaces(piece).get("carpet")!)).toBe(resolveColour("red")!.getHexString());
    expect(surfaces(piece).get("wood")).toBe(surfaces(model).get("wood"));
  });

  it("does not break on a colour or a material that is not one of the known ones, or is missing", async () => {
    const model = await modelOf("sofa");
    const odd = [
      { color: undefined, material: undefined },
      { color: null, material: null },
      { color: 42, material: "constructor" },
      { color: {}, material: ["metal"] },
      { color: "red", material: "stone" },
      { color: "red", material: "__proto__" },
      { color: "constructor", material: "toString" },
    ];

    for (const wanted of odd) {
      const piece = model.clone(true);
      expect(() => applyAppearance(piece, wanted as unknown as Pick<FurnitureItem, "color" | "material">, "carpet"), JSON.stringify(wanted)).not.toThrow();
      for (const material of allMaterials(piece) as MeshStandardMaterial[]) {
        expect(Number.isFinite(material.roughness), JSON.stringify(wanted)).toBe(true);
        expect(Number.isFinite(material.metalness), JSON.stringify(wanted)).toBe(true);
        expect(material.opacity, JSON.stringify(wanted)).toBe(1);
      }
    }
    // A colour that can be read is still used, when the material cannot.
    const piece = model.clone(true);
    applyAppearance(piece, { color: "red", material: "stone" } as unknown as Pick<FurnitureItem, "color" | "material">, "carpet");
    expect(hexOf(surfaces(piece).get("carpet")!)).toBe(resolveColour("red")!.getHexString());
    expect(surfaces(piece).get("carpet")!.envMap).toBeNull();
  });

  it("keeps the model as it is when the model does not say which of its surfaces is the main one", async () => {
    const model = await modelOf("sofa");
    const piece = model.clone(true);

    applyAppearance(piece, item("red", "leather"), undefined);
    applyAppearance(piece, item("red", "leather"), "");

    expect(sameMaterials(model, piece)).toBe(true);
  });

  it("does not take a surface that has no name for the main one when the model gives no name", () => {
    const unnamed = new MeshStandardMaterial({ color: 0x336699 });
    const model = madeOf(unnamed);
    const piece = model.clone(true);

    applyAppearance(piece, item("red", "leather"), "");
    applyAppearance(piece, item("red", "leather"), undefined);

    expect(allMaterials(piece)[0]).toBe(unnamed);
    expect(unnamed.color.getHexString()).toBe("336699");
  });

  it("keeps the model as it is when it has no surface of the name it gives", async () => {
    const model = await modelOf("sofa");
    const piece = model.clone(true);

    applyAppearance(piece, item("red", "leather"), "velvet");

    expect(sameMaterials(model, piece)).toBe(true);
  });

  it("leaves a main surface that is not a standard material alone, and does not fail", () => {
    const flat = new MeshBasicMaterial({ color: 0x336699 });
    flat.name = "main";
    const model = madeOf(flat);
    const piece = model.clone(true);

    expect(() => applyAppearance(piece, item("red", "leather"), "main")).not.toThrow();
    expect(allMaterials(piece)[0]).toBe(flat);
    expect(flat.color.getHexString()).toBe("336699");
  });

  it("copes with a model that has nothing in it", () => {
    expect(() => applyAppearance(new Group(), item("red", "leather"), "main")).not.toThrow();
    expect(() => applyAppearance(new Group().add(new Group()), item("red", "leather"), "main")).not.toThrow();
  });

  it("paints a surface that is one of several materials of a mesh, and keeps the others", () => {
    const main = surface("main", "#336699");
    const trim = surface("trim", "#ffffff");
    const model = new Group().add(new Mesh(new BoxGeometry(1, 1, 1), [trim, main, trim]));
    const piece = model.clone(true);

    applyAppearance(piece, item("red", "leather"), "main");

    const [first, second, third] = materialsIn(piece.children[0] as Mesh) as MeshStandardMaterial[];
    expect(first).toBe(trim);
    expect(third).toBe(trim);
    expect(second).not.toBe(main);
    expect(hexOf(second)).toBe(resolveColour("red")!.getHexString());
    // The model's own list of materials is not changed by painting the piece.
    expect(materialsIn(model.children[0] as Mesh)).toEqual([trim, main, trim]);
  });
});

describe("applyAppearance: two pieces of one type have their own colours (AC3)", () => {
  it("gives each piece the colour of its own item, and leaves the model and the parts that do not change shared", async () => {
    const model = await modelOf("sofa");
    const red = model.clone(true);
    const blue = model.clone(true);
    const unknown = model.clone(true);
    const mainName = mainMaterialOf(model);

    applyAppearance(red, item("red", "fabric"), mainName);
    applyAppearance(blue, item("blue", "fabric"), mainName);
    applyAppearance(unknown, item("unknown", "other"), mainName);

    const [r, b, u, original] = [red, blue, unknown, model].map((piece) => surfaces(piece));
    expect(hexOf(r.get("carpet")!)).toBe(resolveColour("red")!.getHexString());
    expect(hexOf(b.get("carpet")!)).toBe(resolveColour("blue")!.getHexString());
    expect(hexOf(u.get("carpet")!)).toBe(hexOf(original.get("carpet")!));
    expect(new Set([r.get("carpet"), b.get("carpet"), original.get("carpet")]).size).toBe(3);
    // The legs have no colour of their own to give, so they are shared.
    expect(r.get("wood")).toBe(original.get("wood"));
    expect(b.get("wood")).toBe(original.get("wood"));
  });

  it("makes a surface of its own for each piece, also when two pieces have the same colour", async () => {
    const model = await modelOf("sofa");
    const first = model.clone(true);
    const second = model.clone(true);

    applyAppearance(first, item("red", "leather"), mainMaterialOf(model));
    applyAppearance(second, item("red", "leather"), mainMaterialOf(model));
    applyAppearance(second, item("blue", "metal"), mainMaterialOf(second) ?? "carpet");

    expect(surfaces(first).get("carpet")).not.toBe(surfaces(second).get("carpet"));
    expect(hexOf(surfaces(first).get("carpet")!)).toBe(resolveColour("red")!.getHexString());
    expect(surfaces(first).get("carpet")!.metalness).toBe(0);
  });

  it("uses one surface for all the meshes of a piece that share it, so that they are one colour", () => {
    const main = surface("main", "#336699");
    const model = madeOf(main, main, main);
    const piece = model.clone(true);

    applyAppearance(piece, item("red", "leather"), "main");

    const used = allMaterials(piece);
    expect(new Set(used).size).toBe(1);
    expect(used[0]).not.toBe(main);
  });
});

describe("applyAppearance: a surface that is a shade of the main one follows its colour", () => {
  const relation = (type: FurnitureLabel, border: string, main: string) => async () => {
    const model = await modelOf(type);
    const s = surfaces(model);
    return hslOf(s.get(border)!.color).l / hslOf(s.get(main)!.color).l;
  };

  it("keeps a rug's darker border darker than the rug by as much as before, in the colour of the rug", async () => {
    const ratio = await relation("rug", "carpetDarker", "carpet")();
    const { piece } = await pieceOf("rug", item("blue", "fabric"));
    const [main, border] = [surfaces(piece).get("carpet")!, surfaces(piece).get("carpetDarker")!];

    expect(ratio).toBeLessThan(1);
    expect(hslOf(border.color).l / hslOf(main.color).l).toBeCloseTo(ratio, 2);
    expect(Math.abs(hslOf(border.color).h - hslOf(main.color).h)).toBeLessThan(0.01);
    expect(hexOf(border)).not.toBe(hexOf(main));
  });

  it("keeps the colour of the border when there is no colour to give, and gives the look", async () => {
    const model = await modelOf("rug");
    const { piece } = await pieceOf("rug", item("unknown", "leather"));

    expect(hexOf(surfaces(piece).get("carpetDarker")!)).toBe(hexOf(surfaces(model).get("carpetDarker")!));
    expect(surfaces(piece).get("carpetDarker")!.roughness).toBeLessThan(1);
  });

  it("does not make a lighter shade lighter than white", () => {
    const model = madeOf(surface("main", "#406080"), surface("pale", "#a0c0e0"));
    const piece = model.clone(true);

    applyAppearance(piece, item("white", "fabric"), "main");

    const pale = surfaces(piece).get("pale")!;
    for (const channel of [pale.color.r, pale.color.g, pale.color.b]) {
      expect(channel).toBeLessThanOrEqual(1);
      expect(channel).toBeGreaterThanOrEqual(0);
    }
    expect(hslOf(pale.color).l).toBeGreaterThan(hslOf(surfaces(piece).get("main")!.color).l - 0.001);
  });

  it("does not let white, grey or a different colour follow", () => {
    const model = madeOf(
      surface("main", "#c04040"),
      surface("white", "#ffffff"),
      surface("grey", "#808080"),
      surface("legs", "#c09040"),
      surface("blue", "#4040c0"),
    );
    const piece = model.clone(true);

    applyAppearance(piece, item("green", "fabric"), "main");

    const after = surfaces(piece);
    expect(hexOf(after.get("main")!)).toBe(resolveColour("green")!.getHexString());
    for (const name of ["white", "grey", "legs", "blue"]) expect(after.get(name), name).toBe(surfaces(model).get(name));
  });

  it("does not let a grey main surface take shades along: there is no colour to be a shade of", () => {
    // Grey has no hue, which counts as the hue of red, so a red surface must not follow it.
    const model = madeOf(surface("main", "#808080"), surface("darker", "#404040"), surface("reddish", "#a04040"));
    const piece = model.clone(true);

    applyAppearance(piece, item("blue", "fabric"), "main");

    expect(surfaces(piece).get("darker")).toBe(surfaces(model).get("darker"));
    expect(surfaces(piece).get("reddish")).toBe(surfaces(model).get("reddish"));
  });

  it("counts reds on both sides of the colour circle's start as the same colour", () => {
    // A hue just under 360 degrees and one just over 0 are neighbours.
    const model = madeOf(surface("main", new Color().setHSL(359 / 360, 0.7, 0.5, SRGBColorSpace)), surface("shade", new Color().setHSL(2 / 360, 0.7, 0.3, SRGBColorSpace)));
    const piece = model.clone(true);

    applyAppearance(piece, item("blue", "fabric"), "main");

    expect(surfaces(piece).get("shade")).not.toBe(surfaces(model).get("shade"));
  });

  it("does not count colours a good way apart on the circle as one", () => {
    const model = madeOf(surface("main", new Color().setHSL(0.1, 0.7, 0.5, SRGBColorSpace)), surface("other", new Color().setHSL(0.16, 0.7, 0.3, SRGBColorSpace)));
    const piece = model.clone(true);

    applyAppearance(piece, item("blue", "fabric"), "main");

    expect(surfaces(piece).get("other")).toBe(surfaces(model).get("other"));
  });

  it("does not let a surface that is not a standard material follow", () => {
    const basic = new MeshBasicMaterial({ color: new Color().setHSL(0.01, 0.7, 0.3, SRGBColorSpace) });
    basic.name = "shade";
    const model = madeOf(surface("main", new Color().setHSL(0.01, 0.7, 0.5, SRGBColorSpace)), basic);
    const piece = model.clone(true);

    applyAppearance(piece, item("blue", "fabric"), "main");

    expect(allMaterials(piece)[1]).toBe(basic);
  });
});

describe("the main surface a model names", () => {
  it("is stored in the model and read back", () => {
    const model = new Group();

    expect(mainMaterialOf(model)).toBeUndefined();
    setMainMaterial(model, "carpet");
    expect(mainMaterialOf(model)).toBe("carpet");
  });

  it("is only a name, so anything else is as good as none", () => {
    const model = new Group();
    model.userData.mainMaterial = 42;

    expect(mainMaterialOf(model)).toBeUndefined();
    model.userData.mainMaterial = { name: "carpet" };
    expect(mainMaterialOf(model)).toBeUndefined();
  });

  it("survives the copy that makes a piece, which is how the scene finds it", () => {
    const model = new Group();
    setMainMaterial(model, "wood");

    expect(mainMaterialOf(model.clone(true))).toBe("wood");
  });
});
