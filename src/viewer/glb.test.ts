import { describe, expect, it } from "vitest";
import { glbBounds, materialNames, normaliseModel, readGlb, writeGlb, type GltfJson } from "./glb";

/** A model that is one box, 2 m wide (x from 1 to 3), 1 m high (y from 0 to 1) and 0.5 m deep (z from -2 to -1.5). */
const box = (): GltfJson => ({
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "box", mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ min: [1, 0, -2], max: [3, 1, -1.5], count: 8, type: "VEC3", componentType: 5126 }],
  materials: [{ name: "wood" }, { name: "metal" }],
});

const size = (json: GltfJson) => {
  const { min, max } = glbBounds(json);
  return max.clone().sub(min).toArray();
};
const near = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6));
};

describe("readGlb and writeGlb", () => {
  it("write a model that reads back with the same description and the same binary data", () => {
    const binary = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const back = readGlb(writeGlb({ json: box(), binary }));

    expect(back.json).toEqual(box());
    expect(Array.from(back.binary!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("pads every part to a multiple of four bytes, as the format requires, without changing the data", () => {
    const binary = new Uint8Array([9, 8, 7, 6, 5]);

    const bytes = writeGlb({ json: box(), binary });

    expect(bytes.length % 4).toBe(0);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(8, true)).toBe(bytes.length);
    expect(view.getUint32(12, true) % 4).toBe(0);
    const back = readGlb(bytes);
    expect(Array.from(back.binary!.subarray(0, 5))).toEqual([9, 8, 7, 6, 5]);
    expect(back.json).toEqual(box());
  });

  it("handle a model that has no binary data", () => {
    const back = readGlb(writeGlb({ json: box(), binary: null }));

    expect(back.binary).toBeNull();
    expect(back.json).toEqual(box());
  });

  it("keep everything in the description, including parts this code knows nothing about", () => {
    const json = { ...box(), extensionsUsed: ["KHR_materials_unlit"], extras: { note: "кафяво 🛋" } };

    expect(readGlb(writeGlb({ json, binary: null })).json).toEqual(json);
  });

  it("refuse a file that is not a GLB, or is not version 2, or has no description of the model", () => {
    expect(() => readGlb(new Uint8Array(40))).toThrow("not a GLB");
    expect(() => readGlb(new TextEncoder().encode('{"asset":{"version":"2.0"}} and then some more text'))).toThrow("not a GLB");

    const version1 = writeGlb({ json: box(), binary: null });
    new DataView(version1.buffer).setUint32(4, 1, true);
    expect(() => readGlb(version1)).toThrow("version 2");

    const noJson = writeGlb({ json: box(), binary: new Uint8Array(4) });
    new DataView(noJson.buffer).setUint32(16, 0x12345678, true);
    expect(() => readGlb(noJson)).toThrow("no description");
  });

  it("read a view of a larger buffer, as Node does for files", () => {
    const bytes = writeGlb({ json: box(), binary: new Uint8Array(4) });
    const padded = new Uint8Array(bytes.length + 16);
    padded.set(bytes, 7);

    expect(readGlb(padded.subarray(7, 7 + bytes.length)).json).toEqual(box());
  });
});

describe("glbBounds", () => {
  it("is the box that the file states for the vertices of a model that is not moved", () => {
    const { min, max } = glbBounds(box());

    expect(min.toArray()).toEqual([1, 0, -2]);
    expect(max.toArray()).toEqual([3, 1, -1.5]);
  });

  it("follows the moving, scaling and turning of the nodes above the model", () => {
    const moved = box();
    moved.nodes![0].translation = [10, 0, 0];
    near(glbBounds(moved).min.toArray(), [11, 0, -2]);

    const scaled = box();
    scaled.nodes![0].scale = [2, 3, 4];
    near(glbBounds(scaled).max.toArray(), [6, 3, -6]);

    // A quarter turn about the vertical axis swaps the width and the depth.
    const turned = box();
    turned.nodes![0].rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    near(size(turned), [0.5, 1, 2]);
  });

  it("accepts a node given as a matrix, and puts parents and children together", () => {
    const json = box();
    json.nodes = [{ children: [1], translation: [0, 5, 0] }, { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1] }];

    const { min, max } = glbBounds(json);

    near(min.toArray(), [101, 5, -2]);
    near(max.toArray(), [103, 6, -1.5]);
  });

  it("covers every mesh in the scene, and nothing that is not in it", () => {
    const json = box();
    json.nodes = [{ mesh: 0 }, { mesh: 0, translation: [10, 0, 0] }, { mesh: 0, translation: [500, 0, 0] }];
    json.scenes = [{ nodes: [0, 1] }];

    const { min, max } = glbBounds(json);

    near(min.toArray(), [1, 0, -2]);
    near(max.toArray(), [13, 1, -1.5]);
  });

  it("says so when the file does not state the range of the vertices, or has nothing to draw", () => {
    const noRange = box();
    delete noRange.accessors![0].min;
    expect(() => glbBounds(noRange)).toThrow("range");

    const empty = box();
    empty.scenes = [{ nodes: [] }];
    expect(() => glbBounds(empty)).toThrow("nothing to draw");
  });
});

describe("materialNames", () => {
  it("lists the materials in the order of the file", () => {
    expect(materialNames(box())).toEqual(["wood", "metal"]);
    expect(materialNames({ asset: { version: "2.0" } })).toEqual([]);
  });
});

describe("normaliseModel", () => {
  const options = { name: "shelf", scale: 2, turnDegrees: 0 };

  it("puts the base on the floor and the middle of the footprint at the origin", () => {
    const { min, max } = glbBounds(normaliseModel(box(), options));

    near(min.toArray(), [-2, 0, -0.5]);
    near(max.toArray(), [2, 2, 0.5]);
  });

  it("scales the model evenly: twice as big in every direction for a scale of 2", () => {
    near(size(normaliseModel(box(), options)), [4, 2, 1]);
    near(size(normaliseModel(box(), { ...options, scale: 0.5 })), [1, 0.5, 0.25]);
  });

  it("turns the model by quarter turns, so the width and the depth change places", () => {
    near(size(normaliseModel(box(), { ...options, scale: 1, turnDegrees: 90 })), [0.5, 1, 2]);
    near(size(normaliseModel(box(), { ...options, scale: 1, turnDegrees: 180 })), [2, 1, 0.5]);
    near(size(normaliseModel(box(), { ...options, scale: 1, turnDegrees: 270 })), [0.5, 1, 2]);
  });

  it("still puts the base and the middle at the origin after a turn", () => {
    for (const turnDegrees of [0, 90, 180, 270]) {
      const { min, max } = glbBounds(normaliseModel(box(), { ...options, turnDegrees }));

      expect(min.y, `${turnDegrees} degrees`).toBeCloseTo(0, 6);
      expect((min.x + max.x) / 2, `${turnDegrees} degrees`).toBeCloseTo(0, 6);
      expect((min.z + max.z) / 2, `${turnDegrees} degrees`).toBeCloseTo(0, 6);
    }
  });

  it("turns in the direction the script relies on: a quarter turn takes what is on the -x side to the +z side", () => {
    // A body, and a small mark on its -x side.
    const marked: GltfJson = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [{ mesh: 0 }, { mesh: 1 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }, { primitives: [{ attributes: { POSITION: 1 } }] }],
      accessors: [
        { min: [-1, 0, -1], max: [1, 1, 1] },
        { min: [-1.5, 0, -0.1], max: [-1, 0.5, 0.1] },
      ],
    };

    // Where the mark is after each turn, found by looking at the mark alone inside the new node.
    const markAfter = (turnDegrees: number) => {
      const turned = normaliseModel(marked, { name: "marked", scale: 1, turnDegrees });
      turned.nodes![2].children = [1];
      const { min, max } = glbBounds(turned);
      return { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 };
    };

    expect(markAfter(0).x).toBeLessThan(-0.5);
    expect(markAfter(90).z).toBeGreaterThan(0.5);
    expect(markAfter(180).x).toBeGreaterThan(0.5);
    expect(markAfter(270).z).toBeLessThan(-0.5);
  });

  it("works for a model whose own nodes are already moved and scaled", () => {
    const json = box();
    json.nodes![0].translation = [4, 1, 2];
    json.nodes![0].scale = [2, 2, 2];

    const { min, max } = glbBounds(normaliseModel(json, options));

    expect(min.y).toBeCloseTo(0, 6);
    expect((min.x + max.x) / 2).toBeCloseTo(0, 6);
    expect((min.z + max.z) / 2).toBeCloseTo(0, 6);
    near(size(normaliseModel(json, options)), [8, 4, 2]);
  });

  it("wraps the model in one new node, named for it, which becomes the only root", () => {
    const result = normaliseModel(box(), options);

    expect(result.scenes![0].nodes).toEqual([1]);
    expect(result.nodes![1]).toMatchObject({ name: "shelf", children: [0] });
    expect(result.nodes![0]).toEqual({ name: "box", mesh: 0 });
  });

  it("does not change the description that was given", () => {
    const original = box();

    normaliseModel(original, options);

    expect(original).toEqual(box());
  });

  it("survives being written and read back, as a file", () => {
    const back = readGlb(writeGlb({ json: normaliseModel(box(), options), binary: null })).json;

    near(size(back), [4, 2, 1]);
    expect(glbBounds(back).min.y).toBeCloseTo(0, 6);
  });
});
