import type { Group } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { FurnitureLabel } from "../shared/furniture";
import { parseModelLibrary, type ModelEntry, type ModelLibrary } from "../shared/model-library";
import index from "../../public/models/index.json";

/** Where the library is on the site: the files of the folder public/models. */
export const MODEL_FOLDER = "/models";

let checked: ModelLibrary | null = null;

/**
 * The furniture library, as its index lists it. The index is checked the first time it is asked
 * for, and a library that is not complete or not valid throws, so that it shows up at once
 * instead of as a missing piece of furniture in the 3D room.
 */
export function furnitureLibrary(): ModelLibrary {
  checked ??= parseModelLibrary(index);
  return checked;
}

/** The model that stands for a type of furniture. */
export function modelFor(label: FurnitureLabel): ModelEntry {
  const entry = furnitureLibrary().models.find((model) => model.type === label);
  // The library is checked to have a model for every type, so this only guards the types.
  if (!entry) throw new Error(`The furniture library has no model for ${label}.`);
  return entry;
}

/** Where the file of a model is on the site. */
export const modelUrl = (entry: ModelEntry) => `${MODEL_FOLDER}/${entry.file}`;

/**
 * Makes the 3D object of a model from the bytes of its file. The object stands on the floor
 * (y = 0), with the middle of its footprint at x = 0, z = 0, in metres, facing +z, so it only has
 * to be put where it should be. It is as big as the library says (`entry.width_cm` and so on).
 */
export async function parseFurnitureModel(entry: ModelEntry, data: ArrayBuffer): Promise<Group> {
  const gltf = await new GLTFLoader().parseAsync(data, "");
  gltf.scene.name = entry.type;
  return gltf.scene;
}

/**
 * Loads the model for a type of furniture from the site. Each call makes a new object, so the same
 * type can be loaded several times, for several pieces. `fetchFile` is `fetch`, unless something
 * else has to fetch the file.
 */
export async function loadFurnitureModel(label: FurnitureLabel, fetchFile: typeof fetch = fetch): Promise<Group> {
  const entry = modelFor(label);
  const response = await fetchFile(modelUrl(entry));
  if (!response.ok) {
    throw new Error(`The model for ${label} could not be loaded: ${modelUrl(entry)} answered ${response.status}.`);
  }
  try {
    return await parseFurnitureModel(entry, await response.arrayBuffer());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The model for ${label} could not be read: ${reason}`);
  }
}
