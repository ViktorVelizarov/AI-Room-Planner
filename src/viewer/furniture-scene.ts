import {
  Box3,
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type Object3D,
} from "three";
import type { FurnitureItem, FurnitureLabel } from "../shared/furniture";
import type { Placement } from "./arrangement";

/** A piece of furniture and where it stands. */
export type PlacedPiece = { item: FurnitureItem; placement: Placement };

/** A piece that is shown as a plain box, because it has no 3D model to show. */
export type UnmatchedPiece = {
  /** Its place in the list of furniture. */
  index: number;
  type: FurnitureLabel;
  /** "no-model": the library has no model for the type. "load-failed": it has one, but it could not be loaded in time. */
  reason: "no-model" | "load-failed";
};

/** Gives the 3D model of a type of furniture, or `null` if there is none. It may fail, or take long. */
export type ModelLoader = (type: FurnitureLabel) => Promise<Object3D | null>;

/** How long a model may take to load, in milliseconds, before the pieces of its type are shown as boxes. */
export const MODEL_TIMEOUT_MS = 10_000;

const PLACEHOLDER = { box: 0xc9c9c9, outline: 0x555555 };

type Loaded = { model: Object3D; size: Vector3 } | { failure: UnmatchedPiece["reason"] };

/** The answer of `promise`, or a failure if it takes longer than `milliseconds`. */
function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The model took too long to load.")), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function loadType(type: FurnitureLabel, loadModel: ModelLoader, timeoutMs: number): Promise<Loaded> {
  let model: Object3D | null;
  try {
    model = await withTimeout(loadModel(type), timeoutMs);
  } catch {
    return { failure: "load-failed" };
  }
  if (!model) return { failure: "no-model" };
  const box = new Box3().setFromObject(model);
  // A model that has nothing to draw is as good as none.
  if (box.isEmpty()) return { failure: "load-failed" };
  return { model, size: box.getSize(new Vector3()) };
}

/** How many times to stretch a side of a model that is `native` long to make it `wanted` long. A flat side stays as it is. */
const stretch = (wanted: number, native: number) => (native > 1e-6 ? wanted / native : 1);

/**
 * A copy of the model, as big as the piece: stretched along each side to the piece's width, height
 * and depth, and standing where it is placed. A model stands on the floor with the middle of its
 * footprint at its origin, so stretching it about the origin keeps its base on the floor.
 */
function placeModel({ model, size }: { model: Object3D; size: Vector3 }, { item, placement }: PlacedPiece, index: number): Object3D {
  const object = model.clone(true);
  object.scale.set(stretch(item.width_cm / 100, size.x), stretch(item.height_cm / 100, size.y), stretch(item.depth_cm / 100, size.z));
  object.position.set(placement.x_m, 0, placement.z_m);
  object.userData = { index, type: item.label };
  return object;
}

/** A plain grey box of the size of the piece, with an outline, standing where it is placed. */
function placeholderBox({ item, placement }: PlacedPiece, index: number): Object3D {
  const width = item.width_cm / 100;
  const height = item.height_cm / 100;
  const depth = item.depth_cm / 100;

  const box = new Mesh(new BoxGeometry(width, height, depth), new MeshLambertMaterial({ color: PLACEHOLDER.box }));
  const outline = new LineSegments(new EdgesGeometry(box.geometry), new LineBasicMaterial({ color: PLACEHOLDER.outline }));
  // The box is centred on itself, so it is lifted half its height to stand on the floor.
  box.position.y = outline.position.y = height / 2;

  const group = new Group();
  group.name = item.label;
  group.add(box, outline);
  group.position.set(placement.x_m, 0, placement.z_m);
  group.userData = { index, type: item.label, placeholder: true };
  return group;
}

/**
 * Makes the furniture of the 3D room: one object for each piece, in the order of the list, in a
 * group. A piece whose type has a model gets a copy of it, stretched to the piece's size. Each type
 * is loaded once, however many pieces it has, and all the types at the same time. A piece whose
 * type has no model, or whose model cannot be loaded in time, is a plain box of its size, and is
 * listed in `unmatched` so that the user can be told.
 */
export async function buildFurniture(
  pieces: readonly PlacedPiece[],
  loadModel: ModelLoader,
  timeoutMs = MODEL_TIMEOUT_MS,
): Promise<{ group: Group; unmatched: UnmatchedPiece[] }> {
  const loads = new Map<FurnitureLabel, Promise<Loaded>>();
  const loadOnce = (type: FurnitureLabel) => {
    let load = loads.get(type);
    if (!load) {
      load = loadType(type, loadModel, timeoutMs);
      loads.set(type, load);
    }
    return load;
  };
  const results = await Promise.all(pieces.map((piece) => loadOnce(piece.item.label)));

  const group = new Group();
  group.name = "furniture";
  const unmatched: UnmatchedPiece[] = [];
  pieces.forEach((piece, index) => {
    const loaded = results[index];
    if ("model" in loaded) {
      group.add(placeModel(loaded, piece, index));
    } else {
      group.add(placeholderBox(piece, index));
      unmatched.push({ index, type: piece.item.label, reason: loaded.failure });
    }
  });
  return { group, unmatched };
}
