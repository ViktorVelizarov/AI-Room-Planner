import { Matrix4, Quaternion, Vector3 } from "three";

/** The parts of a glTF file that this code reads and changes. Anything else in the file is kept as it is. */
export type GltfNode = {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  [key: string]: unknown;
};

export type GltfJson = {
  asset: { version: string; generator?: string; copyright?: string; [key: string]: unknown };
  scene?: number;
  scenes?: { nodes?: number[]; [key: string]: unknown }[];
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes: Record<string, number> }[]; [key: string]: unknown }[];
  accessors?: { min?: number[]; max?: number[]; [key: string]: unknown }[];
  materials?: { name?: string; [key: string]: unknown }[];
  [key: string]: unknown;
};

// The four-letter names of the parts of a GLB file, read as little-endian numbers.
const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BINARY_CHUNK = 0x004e4942; // "BIN\0"

/** A GLB file taken apart: its description of the model as JSON, and the binary data it points to. */
export type Glb = { json: GltfJson; binary: Uint8Array | null };

export function readGlb(bytes: Uint8Array): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== MAGIC) throw new Error("This is not a GLB file.");
  if (view.getUint32(4, true) !== 2) throw new Error("Only version 2 of the GLB format is supported.");

  let json: GltfJson | null = null;
  let binary: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
    else if (type === BINARY_CHUNK) binary = bytes.slice(start, start + length);
    offset = start + length;
  }
  if (!json) throw new Error("This GLB file has no description of its model.");
  return { json, binary };
}

/** Puts the parts back together. The binary data is written as it was read, so the model itself does not change. */
export function writeGlb({ json, binary }: Glb): Uint8Array {
  // Each part must be a multiple of four bytes long: the JSON is padded with spaces.
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binaryLength = binary ? Math.ceil(binary.length / 4) * 4 : 0;
  const total = 12 + 8 + jsonLength + (binary ? 8 + binaryLength : 0);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  if (binary) {
    const start = 20 + jsonLength;
    view.setUint32(start, binaryLength, true);
    view.setUint32(start + 4, BINARY_CHUNK, true);
    out.set(binary, start + 8);
  }
  return out;
}

export type Bounds = { min: Vector3; max: Vector3 };

const nodeMatrix = (node: GltfNode) =>
  node.matrix
    ? new Matrix4().fromArray(node.matrix)
    : new Matrix4().compose(
        new Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );

/**
 * The box around the whole model as the scene shows it, in the model's own units (metres in glTF),
 * worked out from the ranges that the file states for its vertex positions. Nothing is loaded or
 * drawn, so it needs no graphics. For a model turned by anything but a multiple of 90 degrees the
 * box is a little larger than the model.
 */
export function glbBounds(json: GltfJson): Bounds {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const nodes = json.nodes ?? [];

  const visit = (index: number, parent: Matrix4) => {
    const node = nodes[index];
    const world = parent.clone().multiply(nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes![node.mesh].primitives) {
        const { min: low, max: high } = json.accessors![primitive.attributes.POSITION];
        if (!low || !high) throw new Error("A vertex position range is missing in this model.");
        for (const x of [low[0], high[0]]) {
          for (const y of [low[1], high[1]]) {
            for (const z of [low[2], high[2]]) {
              const corner = new Vector3(x, y, z).applyMatrix4(world);
              min.min(corner);
              max.max(corner);
            }
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  const scene = json.scenes?.[json.scene ?? 0];
  for (const root of scene?.nodes ?? []) visit(root, new Matrix4());
  if (!Number.isFinite(min.x)) throw new Error("This model has nothing to draw.");
  return { min, max };
}

/** The names of the materials a model uses, in the order the file lists them. */
export const materialNames = (json: GltfJson): string[] => (json.materials ?? []).map((material) => material.name ?? "");

/**
 * Puts the whole model inside a new node, which turns it about the vertical axis (by a multiple of
 * 90 degrees), scales it evenly, and then moves it so that its base is at y = 0 and the middle of
 * its footprint is at x = 0, z = 0. Returns a new description; the one given is not changed.
 */
export function normaliseModel(json: GltfJson, options: { name: string; scale: number; turnDegrees: number }): GltfJson {
  const copy: GltfJson = structuredClone(json);
  const sceneIndex = copy.scene ?? 0;
  const scene = copy.scenes![sceneIndex];
  const nodes = (copy.nodes ??= []);

  const half = (options.turnDegrees * Math.PI) / 360;
  const wrapper: GltfNode = {
    name: options.name,
    children: scene.nodes,
    rotation: [0, Math.sin(half), 0, Math.cos(half)],
    scale: [options.scale, options.scale, options.scale],
    translation: [0, 0, 0],
  };
  nodes.push(wrapper);
  scene.nodes = [nodes.length - 1];

  // With the turn and the scale in place, find where the model is, and move it back to the origin.
  const { min, max } = glbBounds(copy);
  wrapper.translation = [-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2];
  return copy;
}
