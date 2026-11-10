import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Box3, BoxGeometry, Group, Mesh, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, Vector3, type Material, type Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FURNITURE_LABELS, TYPICAL_ITEMS, typicalItem, type FurnitureItem, type FurnitureLabel } from "../shared/furniture";
import { resolveColour } from "./colour";
import { MODEL_FOLDER, loadFurnitureModel } from "./furniture-library";
import { MODEL_TIMEOUT_MS, buildFurniture, type ModelLoader, type PlacedPiece } from "./furniture-scene";
import { disposeObject } from "./room-scene";

const folder = join(process.cwd(), "public", "models");

/** Fetches a file of the library from the disk, the way the site would serve it. */
const fetchFromDisk = (async (input: string | URL | Request) => {
  const path = join(folder, String(input).replace(`${MODEL_FOLDER}/`, ""));
  return existsSync(path) ? new Response(readFileSync(path)) : new Response("not found", { status: 404 });
}) as typeof fetch;

/** The real models of the library. */
const realModels: ModelLoader = (type) => loadFurnitureModel(type, fetchFromDisk);

const sofa: FurnitureItem = { label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "grey", material: "fabric" };
const at = (x_m: number, z_m: number) => ({ x_m, z_m });
const placed = (item: FurnitureItem, x = 0, z = 0): PlacedPiece => ({ item, placement: at(x, z) });

const boxOf = (object: Object3D) => new Box3().setFromObject(object);
const sizeCm = (object: Object3D) => boxOf(object).getSize(new Vector3()).multiplyScalar(100);

afterEach(() => {
  vi.useRealTimers();
});

describe("buildFurniture: a piece whose type has a model (AC1)", () => {
  it.each(FURNITURE_LABELS)("%s: shows the model as big as the piece, standing on the floor where it is placed", async (type) => {
    const item = typicalItem(type);

    const { group } = await buildFurniture([placed(item, 1.5, -0.75)], realModels);

    const box = boxOf(group.children[0]);
    const size = box.getSize(new Vector3()).multiplyScalar(100);
    expect(size.x).toBeCloseTo(item.width_cm, 4);
    expect(size.z).toBeCloseTo(item.depth_cm, 4);
    expect(size.y).toBeCloseTo(item.height_cm, 4);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(1.5, 6);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(-0.75, 6);
  });

  it("stretches the model to a size that has different proportions from its own", async () => {
    const wide = { ...sofa, width_cm: 300, depth_cm: 100, height_cm: 50 };

    const { group } = await buildFurniture([placed(wide)], realModels);

    const size = sizeCm(group.children[0]);
    expect([size.x, size.z, size.y].map((value) => Math.round(value * 100) / 100)).toEqual([300, 100, 50]);
  });

  it("shows a model, not a box, and says nothing is unmatched when every type has one", async () => {
    const { group, unmatched } = await buildFurniture(
      FURNITURE_LABELS.map((type) => placed(typicalItem(type))),
      realModels,
    );

    expect(unmatched).toEqual([]);
    expect(group.children).toHaveLength(15);
    for (const piece of group.children) expect(piece.userData.placeholder, piece.name).toBeUndefined();
  });

  it("puts the pieces in the group in the order of the list, each knowing its place in the list and its type", async () => {
    const { group } = await buildFurniture([placed(typicalItem("desk")), placed(typicalItem("bed")), placed(typicalItem("rug"))], realModels);

    expect(group.name).toBe("furniture");
    expect(group.children.map((piece) => piece.userData)).toEqual([
      { index: 0, type: "desk" },
      { index: 1, type: "bed" },
      { index: 2, type: "rug" },
    ]);
  });

  it("makes a separate object for each piece, so two sofas can have different sizes and places", async () => {
    const small = { ...sofa, width_cm: 150 };

    const { group } = await buildFurniture([placed(sofa, -1, 0), placed(small, 1, 2)], realModels);

    const [first, second] = group.children;
    expect(first).not.toBe(second);
    expect(sizeCm(first).x).toBeCloseTo(200, 4);
    expect(sizeCm(second).x).toBeCloseTo(150, 4);
    expect(first.position.toArray()).toEqual([-1, 0, 0]);
    expect(second.position.toArray()).toEqual([1, 0, 2]);
  });

  it("loads each type once, however many pieces it has", async () => {
    const loader = vi.fn(realModels);
    const pieces = [sofa, typicalItem("desk"), sofa, sofa, typicalItem("desk"), typicalItem("rug"), sofa].map((item) => placed(item));

    const { group } = await buildFurniture(pieces, loader);

    expect(group.children).toHaveLength(7);
    expect(loader).toHaveBeenCalledTimes(3);
    expect(loader.mock.calls.map(([type]) => type).sort()).toEqual(["desk", "rug", "sofa"]);
  });

  it("loads all the types at the same time, not one after the other", async () => {
    const waiting: ((model: Object3D) => void)[] = [];
    const loader: ModelLoader = () => new Promise((resolve) => waiting.push(resolve));
    const types: FurnitureLabel[] = ["sofa", "bed", "desk", "rug"];

    const building = buildFurniture(types.map((type) => placed(typicalItem(type))), loader);
    await Promise.resolve();

    // Every type has been asked for before any of them has answered.
    expect(waiting).toHaveLength(4);
    for (const resolve of waiting) resolve(new Group().add(new Mesh(new BoxGeometry(1, 1, 1))));
    expect((await building).group.children).toHaveLength(4);
  });

  it("has an empty group for an empty list", async () => {
    const { group, unmatched } = await buildFurniture([], realModels);

    expect(group.children).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  it("keeps a flat model flat instead of stretching it by an endless amount", async () => {
    const flat = new Group().add(new Mesh(new PlaneGeometry(2, 1).rotateX(-Math.PI / 2), new MeshLambertMaterial()));

    const { group, unmatched } = await buildFurniture([placed({ ...typicalItem("rug"), height_cm: 5 })], async () => flat);

    expect(unmatched).toEqual([]);
    const scale = group.children[0].scale;
    expect([scale.x, scale.y, scale.z].every(Number.isFinite)).toBe(true);
    expect(scale.y).toBe(1);
  });

  it("copes with the smallest and the largest sizes a piece may have", async () => {
    const tiny = { ...sofa, width_cm: 0.1, depth_cm: 0.1, height_cm: 0.1 };
    const huge = { ...sofa, width_cm: 1000, depth_cm: 1000, height_cm: 1000 };

    const { group } = await buildFurniture([placed(tiny), placed(huge)], realModels);

    expect(sizeCm(group.children[0]).x).toBeCloseTo(0.1, 4);
    expect(sizeCm(group.children[1]).x).toBeCloseTo(1000, 3);
  });
});

/** The material of a piece that has the given name in its model's file. */
function surfaceOf(piece: Object3D, name: string): MeshStandardMaterial {
  let found: MeshStandardMaterial | undefined;
  piece.traverse((part) => {
    if (!(part instanceof Mesh)) return;
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) if (material.name === name) found = material as MeshStandardMaterial;
  });
  if (!found) throw new Error(`no material called ${name}`);
  return found;
}

/** Every material of a piece, mesh by mesh. */
function materialsOfPiece(piece: Object3D): Material[] {
  const found: Material[] = [];
  piece.traverse((part) => part instanceof Mesh && found.push(...(Array.isArray(part.material) ? part.material : [part.material])));
  return found;
}

const hexOfSurface = (material: MeshStandardMaterial) => material.color.getHexString();

describe("buildFurniture: the colour and material of each piece (US-17)", () => {
  it("gives the main surface of each piece the colour of its item (AC1)", async () => {
    const desk = { ...typicalItem("desk"), color: "white", material: "wood" as const };

    const { group } = await buildFurniture([placed(sofa), placed(desk)], realModels);

    // The main surface of a sofa is its upholstery, and of a desk its wood: the model's own names.
    expect(hexOfSurface(surfaceOf(group.children[0], "carpet"))).toBe(resolveColour("grey")!.getHexString());
    expect(hexOfSurface(surfaceOf(group.children[1], "wood"))).toBe(resolveColour("white")!.getHexString());
    // The rest of a model keeps its own colour: a sofa's legs, a desk's handles.
    expect(hexOfSurface(surfaceOf(group.children[0], "wood"))).not.toBe(resolveColour("grey")!.getHexString());
    expect(hexOfSurface(surfaceOf(group.children[1], "metal"))).not.toBe(resolveColour("white")!.getHexString());
  });

  it("gives it the look of the material of its item, so that leather is not matt and metal is metal (AC1)", async () => {
    const leather = { ...sofa, material: "leather" as const };
    const metal = { ...sofa, material: "metal" as const };

    const { group } = await buildFurniture([placed(sofa), placed(leather), placed(metal)], realModels);

    const [fabricSurface, leatherSurface, metalSurface] = group.children.map((piece) => surfaceOf(piece, "carpet"));
    expect(fabricSurface.roughness).toBe(1);
    expect(leatherSurface.roughness).toBeLessThan(fabricSurface.roughness);
    expect(metalSurface.metalness).toBeGreaterThan(0.5);
    expect(fabricSurface.metalness).toBe(0);
  });

  it("gives two pieces of one type that have different colours a colour each (AC3)", async () => {
    const red = { ...sofa, color: "red" };
    const blue = { ...sofa, color: "blue" };

    const { group } = await buildFurniture([placed(red, -1.5), placed(blue, 1.5)], realModels);

    const [first, second] = group.children.map((piece) => surfaceOf(piece, "carpet"));
    expect(first).not.toBe(second);
    expect(hexOfSurface(first)).toBe(resolveColour("red")!.getHexString());
    expect(hexOfSurface(second)).toBe(resolveColour("blue")!.getHexString());
  });

  it("does not paint the model that its pieces are copied from, so no other piece takes a colour that is not its own (AC3)", async () => {
    const prototype = await realModels("sofa");
    const before = hexOfSurface(surfaceOf(prototype!, "carpet"));

    const { group } = await buildFurniture([placed({ ...sofa, color: "red" }), placed({ ...sofa, color: "blue" }), placed({ ...sofa, color: "unknown", material: "other" })], async () => prototype);

    expect(hexOfSurface(surfaceOf(prototype!, "carpet"))).toBe(before);
    // The piece with nothing to change is the model's own look.
    expect(hexOfSurface(surfaceOf(group.children[2], "carpet"))).toBe(before);
    expect(hexOfSurface(surfaceOf(group.children[0], "carpet"))).not.toBe(before);
  });

  it("keeps the model's own look for a piece whose colour and material are unknown (AC2)", async () => {
    const unknown = { ...sofa, color: "unknown", material: "other" as const };

    const { group, unmatched } = await buildFurniture([placed(unknown), placed(unknown)], realModels);

    expect(unmatched).toEqual([]);
    // Nothing to paint, so the pieces of the type share the materials of the model, which is how the model looks as it is.
    const [first, second] = group.children.map(materialsOfPiece);
    expect(first.length).toBeGreaterThan(1);
    expect(first.every((material, index) => material === second[index])).toBe(true);
    expect(hexOfSurface(surfaceOf(group.children[0], "carpet"))).toBe("f9a39e");
  });

  it("keeps the model's own look when it does not say which surface is its main one, and does not fail (AC2)", async () => {
    const plain = new MeshStandardMaterial({ color: 0x336699 });
    const unnamed = new Group().add(new Mesh(new BoxGeometry(1, 1, 1), plain));

    const { group, unmatched } = await buildFurniture([placed({ ...sofa, color: "red", material: "leather" })], async () => unnamed);

    expect(unmatched).toEqual([]);
    expect(materialsOfPiece(group.children[0])).toEqual([plain]);
    expect(plain.color.getHexString()).toBe("336699");
  });

  it("shows a box for a type that has no model as the same plain grey box whatever the colour and material", async () => {
    const { group } = await buildFurniture([placed({ ...sofa, color: "red", material: "metal" })], async () => null);

    const meshes: Mesh[] = [];
    group.traverse((part) => part instanceof Mesh && meshes.push(part));
    expect((meshes[0].material as MeshLambertMaterial).color.getHexString()).toBe("c9c9c9");
  });

  it("does not leave the model's name for its main surface on the pieces, which only know their place and type", async () => {
    const { group } = await buildFurniture([placed({ ...sofa, color: "red" })], realModels);

    expect(group.children[0].userData).toEqual({ index: 0, type: "sofa" });
  });
});

describe("buildFurniture: a piece whose type has no model (AC2)", () => {
  const without =
    (...missing: FurnitureLabel[]): ModelLoader =>
    (type) =>
      missing.includes(type) ? Promise.resolve(null) : realModels(type);

  it("shows a plain box of the piece's size instead, on the floor where it is placed", async () => {
    const bed = typicalItem("bed");

    const { group } = await buildFurniture([placed(bed, -0.5, 1)], without("bed"));

    const piece = group.children[0];
    const box = boxOf(piece);
    const size = box.getSize(new Vector3()).multiplyScalar(100);
    expect([size.x, size.z, size.y].map((value) => Math.round(value * 1000) / 1000)).toEqual([bed.width_cm, bed.depth_cm, bed.height_cm]);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(-0.5, 6);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(1, 6);
    expect(piece.userData).toEqual({ index: 0, type: "bed", placeholder: true });
  });

  it("makes the box a plain, outlined, grey box, which is a box and not a model", async () => {
    const { group } = await buildFurniture([placed(sofa)], without("sofa"));

    const meshes: Mesh[] = [];
    group.traverse((part) => part instanceof Mesh && meshes.push(part));
    expect(meshes).toHaveLength(1);
    expect(meshes[0].geometry).toBeInstanceOf(BoxGeometry);
    expect((meshes[0].geometry as BoxGeometry).parameters).toMatchObject({ width: 2, height: 0.85, depth: 0.9 });
    expect(group.children[0].children).toHaveLength(2);
  });

  it("lists the piece as unmatched, with its place in the list and its type", async () => {
    const { unmatched } = await buildFurniture([placed(sofa), placed(typicalItem("bed")), placed(typicalItem("desk"))], without("bed"));

    expect(unmatched).toEqual([{ index: 1, type: "bed", reason: "no-model" }]);
  });

  it("lists every piece of the type, in the order of the list, and shows the others as models", async () => {
    const pieces = [sofa, typicalItem("desk"), sofa, typicalItem("rug"), typicalItem("desk")].map((item) => placed(item));

    const { group, unmatched } = await buildFurniture(pieces, without("desk"));

    expect(unmatched.map(({ index, type }) => [index, type])).toEqual([
      [1, "desk"],
      [4, "desk"],
    ]);
    expect(group.children.map((piece) => Boolean(piece.userData.placeholder))).toEqual([false, true, false, false, true]);
  });

  it("does the same when a model cannot be loaded, and says so differently", async () => {
    const broken: ModelLoader = (type) => (type === "desk" ? Promise.reject(new Error("404")) : realModels(type));

    const { group, unmatched } = await buildFurniture([placed(sofa), placed(typicalItem("desk"))], broken);

    expect(unmatched).toEqual([{ index: 1, type: "desk", reason: "load-failed" }]);
    expect(group.children[1].userData.placeholder).toBe(true);
    expect(group.children[0].userData.placeholder).toBeUndefined();
  });

  it("treats a model that has nothing to draw as one that could not be loaded", async () => {
    const empty: ModelLoader = async () => new Group();

    const { unmatched } = await buildFurniture([placed(sofa)], empty);

    expect(unmatched).toEqual([{ index: 0, type: "sofa", reason: "load-failed" }]);
  });

  it("can have every piece unmatched, as boxes", async () => {
    const none: ModelLoader = async () => null;

    const { group, unmatched } = await buildFurniture(FURNITURE_LABELS.map((type) => placed(typicalItem(type))), none);

    expect(unmatched).toHaveLength(15);
    for (const type of FURNITURE_LABELS) {
      const piece = group.children[FURNITURE_LABELS.indexOf(type)];
      expect(sizeCm(piece).x, type).toBeCloseTo(TYPICAL_ITEMS[type].width_cm, 4);
    }
  });
});

describe("buildFurniture: a model that takes too long", () => {
  it("is shown as boxes after the time allowed, and the models that came in time are shown as models", async () => {
    vi.useFakeTimers();
    const slow: ModelLoader = (type) => (type === "desk" ? new Promise(() => {}) : realModels(type));

    const building = buildFurniture([placed(sofa), placed(typicalItem("desk")), placed(typicalItem("desk"))], slow);
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS + 1);
    const { group, unmatched } = await building;

    expect(unmatched).toEqual([
      { index: 1, type: "desk", reason: "load-failed" },
      { index: 2, type: "desk", reason: "load-failed" },
    ]);
    expect(group.children[0].userData.placeholder).toBeUndefined();
  });

  it("does not make anyone wait that long when the models come at once, and leaves no timer behind", async () => {
    vi.useFakeTimers();

    const { unmatched } = await buildFurniture([placed(sofa), placed(typicalItem("desk"))], realModels);

    expect(unmatched).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits as long as it is told to", async () => {
    vi.useFakeTimers();
    const never: ModelLoader = () => new Promise(() => {});

    const building = buildFurniture([placed(sofa)], never, 500);
    await vi.advanceTimersByTimeAsync(499);
    let done = false;
    void building.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);

    expect((await building).unmatched).toHaveLength(1);
  });
});

describe("the furniture can be freed", () => {
  it("frees the boxes and the models of every piece", async () => {
    const { group } = await buildFurniture([placed(sofa), placed(typicalItem("bed"))], (type) => (type === "bed" ? Promise.resolve(null) : realModels(type)));
    const freed = new Set<unknown>();
    const held = new Set<{ dispose: () => void }>();
    group.traverse((part) => {
      if (!(part instanceof Mesh || "geometry" in part)) return;
      const { geometry, material } = part as Mesh;
      held.add(geometry);
      for (const one of Array.isArray(material) ? material : [material]) held.add(one);
    });
    for (const item of held) vi.spyOn(item, "dispose").mockImplementation(() => void freed.add(item));

    disposeObject(group);

    expect(held.size).toBeGreaterThanOrEqual(4);
    for (const item of held) expect(freed.has(item)).toBe(true);
  });
});
