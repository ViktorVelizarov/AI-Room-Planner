import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Box3, Mesh, Vector3, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { FURNITURE_LABELS, TYPICAL_ITEMS, type FurnitureLabel } from "../shared/furniture";
import { typesWithoutModel } from "../shared/model-library";
import { glbBounds, materialNames, readGlb } from "./glb";
import { MODEL_FOLDER, furnitureLibrary, loadFurnitureModel, modelFor, modelUrl, parseFurnitureModel } from "./furniture-library";

const folder = join(process.cwd(), "public", "models");
const fileOf = (name: string) => readFileSync(join(folder, name));
const models = furnitureLibrary().models;

/** Fetches a file of the library from the disk, the way the site would serve it. */
const fetchFromDisk = vi.fn(async (input: string | URL | Request) => {
  const path = join(folder, String(input).replace(`${MODEL_FOLDER}/`, ""));
  return existsSync(path) ? new Response(readFileSync(path)) : new Response("not found", { status: 404 });
}) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const MB = 1024 * 1024;

describe("the library folder: every type has a model, in a small GLB file (AC1)", () => {
  it("has a model for each of the 15 supported types", () => {
    expect(typesWithoutModel(furnitureLibrary())).toEqual([]);
    for (const type of FURNITURE_LABELS) expect(models.some((model) => model.type === type), type).toBe(true);
  });

  it.each(models.map((model) => [model.type, model.file] as const))("%s: %s exists and is a GLB file", (_type, file) => {
    expect(existsSync(join(folder, file))).toBe(true);
    expect(fileOf(file).subarray(0, 4).toString("latin1")).toBe("glTF");
  });

  it.each(models.map((model) => [model.type, model.file] as const))("%s: %s is small enough to load quickly, under 2 MB", (_type, file) => {
    expect(statSync(join(folder, file)).size).toBeLessThan(2 * MB);
  });

  it("is small as a whole too: the whole library is under 1 MB", () => {
    const total = models.reduce((sum, model) => sum + statSync(join(folder, model.file)).size, 0);

    expect(total).toBeLessThan(1 * MB);
  });
});

describe("the index: every model is listed with its type, file, licence and credit (AC3)", () => {
  it("is in the library folder, as index.json", () => {
    expect(existsSync(join(folder, "index.json"))).toBe(true);
    expect(JSON.parse(fileOf("index.json").toString("utf8")).models).toHaveLength(models.length);
  });

  it("lists every model file in the folder, and the folder holds nothing the index does not know", () => {
    const expected = [...models.map((model) => model.file), "index.json", "LICENSE-kenney-furniture-kit.txt"].sort();

    expect(readdirSync(folder).sort()).toEqual(expected);
  });

  it.each(models.map((model) => [model.type, model] as const))("%s: has a licence and a credit", (_type, model) => {
    expect(model.licence.length).toBeGreaterThan(0);
    expect(model.credit.length).toBeGreaterThan(0);
    expect(model.licence_url).toMatch(/^https:\/\//);
    expect(model.source.url).toMatch(/^https:\/\//);
  });

  it("uses only licences that the project may use in a web app (CC0, or CC BY with its credit shown)", () => {
    for (const model of models) {
      expect(model.licence, model.file).toMatch(/^(CC0 1\.0|CC BY \d\.\d)$/);
      if (model.licence.startsWith("CC BY")) expect(model.credit_required, `${model.file}: CC BY needs a credit`).toBe(true);
    }
  });

  it("keeps the licence and the credit in each file too, so they stay with a file that is copied elsewhere", () => {
    for (const model of models) {
      const { json } = readGlb(new Uint8Array(fileOf(model.file)));

      expect(json.asset.copyright, model.file).toContain(model.credit);
      expect(json.asset.copyright, model.file).toContain(model.licence);
    }
  });

  it("ships the licence text of the pack the models come from", () => {
    expect(fileOf("LICENSE-kenney-furniture-kit.txt").toString("utf8")).toContain("Creative Commons Zero");
  });

  it("says how a model was changed, and which model of the pack it is", () => {
    for (const model of models) {
      expect(model.changes, model.file).toMatch(/Scaled by \d/);
      expect(model.source.name.length, model.file).toBeGreaterThan(0);
    }
  });

  it("describes each file as it really is: its size, and its materials with the main one among them", () => {
    for (const model of models) {
      const { json } = readGlb(new Uint8Array(fileOf(model.file)));
      const { min, max } = glbBounds(json);

      // The index gives the size to a tenth of a centimetre.
      expect((max.x - min.x) * 100, `${model.file} width`).toBeCloseTo(model.width_cm, 0);
      expect((max.z - min.z) * 100, `${model.file} depth`).toBeCloseTo(model.depth_cm, 0);
      expect((max.y - min.y) * 100, `${model.file} height`).toBeCloseTo(model.height_cm, 0);
      expect(materialNames(json).filter(Boolean).sort(), model.file).toEqual([...new Set(model.materials)].sort());
      expect(model.materials, model.file).toContain(model.main_material);
    }
  });
});

describe("loading a model into the scene (AC2)", () => {
  const sizeOf = (object: Object3D) => new Box3().setFromObject(object).getSize(new Vector3());

  it.each(FURNITURE_LABELS)("%s: stands on the floor, with the middle of its footprint at the origin", async (type) => {
    const box = new Box3().setFromObject(await loadFurnitureModel(type, fetchFromDisk));

    expect(box.min.y).toBeCloseTo(0, 6);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 6);
  });

  it.each(FURNITURE_LABELS)("%s: has the size the index gives, in metres", async (type) => {
    const entry = modelFor(type);
    const size = sizeOf(await loadFurnitureModel(type, fetchFromDisk));

    expect(size.x * 100).toBeCloseTo(entry.width_cm, 0);
    expect(size.z * 100).toBeCloseTo(entry.depth_cm, 0);
    expect(size.y * 100).toBeCloseTo(entry.height_cm, 0);
  });

  it.each(FURNITURE_LABELS)("%s: is a realistic size, within half to twice the typical size of its type", async (type) => {
    const typical = TYPICAL_ITEMS[type];
    const size = sizeOf(await loadFurnitureModel(type, fetchFromDisk));

    for (const [name, actual, expected] of [
      ["width", size.x * 100, typical.width_cm],
      ["depth", size.z * 100, typical.depth_cm],
      ["height", size.y * 100, typical.height_cm],
    ] as const) {
      expect(actual / expected, `${type} ${name}: ${actual.toFixed(1)} cm against a typical ${expected} cm`).toBeGreaterThanOrEqual(0.5);
      expect(actual / expected, `${type} ${name}: ${actual.toFixed(1)} cm against a typical ${expected} cm`).toBeLessThanOrEqual(2);
    }
  });

  it("makes a sofa about 2 m wide, as the story says", async () => {
    const sofa = sizeOf(await loadFurnitureModel("sofa", fetchFromDisk));

    expect(sofa.x).toBeGreaterThan(1.8);
    expect(sofa.x).toBeLessThan(2.2);
  });

  it("names the object after the type, and makes a new object each time, so one type can be several pieces", async () => {
    const first = await loadFurnitureModel("armchair", fetchFromDisk);
    const second = await loadFurnitureModel("armchair", fetchFromDisk);

    expect(first.name).toBe("armchair");
    expect(second).not.toBe(first);
    first.scale.set(3, 3, 3);
    expect(sizeOf(second).x).toBeLessThan(1);
  });

  it("asks the site for the file the index names, in the library folder", async () => {
    fetchFromDisk.mockClear();

    await loadFurnitureModel("bed", fetchFromDisk);

    expect(fetchFromDisk).toHaveBeenCalledTimes(1);
    expect(fetchFromDisk).toHaveBeenCalledWith("/models/bed.glb");
    expect(modelUrl(modelFor("bed"))).toBe("/models/bed.glb");
  });

  it("says which model and which address when the file is not there", async () => {
    const missing = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

    await expect(loadFurnitureModel("desk", missing)).rejects.toThrow("The model for desk could not be loaded: /models/desk.glb answered 404.");
  });

  it("says which model when the file is not a model", async () => {
    const wrong = vi.fn(async () => new Response("<html>not a model</html>")) as unknown as typeof fetch;

    await expect(loadFurnitureModel("desk", wrong)).rejects.toThrow("The model for desk could not be read");
  });

  it("can be made from the bytes of a file, without fetching it", async () => {
    const bytes = fileOf("rug.glb");

    const rug = await parseFurnitureModel(modelFor("rug"), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    expect(rug.name).toBe("rug");
    expect(sizeOf(rug).x * 100).toBeCloseTo(modelFor("rug").width_cm, 0);
  });
});

describe("which way the models face: +z, the front of the room", () => {
  /** Every vertex of an object in the scene, with the name of its material. */
  function vertices(root: Object3D) {
    root.updateWorldMatrix(true, true);
    const found: { point: Vector3; material: string }[] = [];
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      for (let i = 0; i < positions.count; i++) {
        found.push({ point: new Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld), material: material.name });
      }
    });
    return found;
  }
  const meanZ = (points: { point: Vector3 }[]) => points.reduce((sum, { point }) => sum + point.z, 0) / points.length;

  // On a seat the backrest is the high part, and it is behind the person sitting, so the seat
  // faces the other way. The bed's high part is its headboard, which is at the head, not the foot.
  it.each<FurnitureLabel>(["sofa", "armchair", "dining_chair", "office_chair", "bed"])(
    "%s: its high part, the backrest or headboard, is at the back (-z), so it faces +z",
    async (type) => {
      const scene = await loadFurnitureModel(type, fetchFromDisk);
      const box = new Box3().setFromObject(scene);
      const depth = box.max.z - box.min.z;
      const high = vertices(scene).filter(({ point }) => point.y > box.min.y + 0.65 * (box.max.y - box.min.y));

      expect(high.length).toBeGreaterThan(10);
      expect(meanZ(high), `${type}: the high part is at z = ${(meanZ(high) * 100).toFixed(1)} cm`).toBeLessThan(-0.05 * depth);
    },
  );

  // Handles are on the front of a drawer or a door.
  it.each<FurnitureLabel>(["nightstand", "dresser", "desk"])("%s: its handles are at the front (+z), so it faces +z", async (type) => {
    const scene = await loadFurnitureModel(type, fetchFromDisk);
    const box = new Box3().setFromObject(scene);
    const depth = box.max.z - box.min.z;
    const handles = vertices(scene).filter(({ material }) => material === "metal");

    expect(handles.length).toBeGreaterThan(10);
    expect(meanZ(handles), `${type}: the handles are at z = ${(meanZ(handles) * 100).toFixed(1)} cm`).toBeGreaterThan(0.1 * depth);
  });
});

describe("modelFor and furnitureLibrary", () => {
  it("find the model of a type in the library, which is checked once", () => {
    expect(furnitureLibrary()).toBe(furnitureLibrary());
    for (const type of FURNITURE_LABELS) expect(modelFor(type).type).toBe(type);
  });
});
