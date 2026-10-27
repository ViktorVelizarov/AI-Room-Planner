// Makes the furniture model library in public/models from the Kenney Furniture Kit.
//
//   npm run models -- <the unpacked kit>      the folder that holds "Models" and "License.txt"
//
// For each type of furniture it takes one model from the kit, scales it to a realistic size, puts its
// base on the floor with the middle of its footprint at the origin, turns it to face +z, and writes it
// as public/models/<type>.glb. It also writes the index (public/models/index.json) and a copy of the
// kit's licence. Running it again gives the same files. Download the kit from
// https://kenney.nl/assets/furniture-kit (docs/furniture-model-licences.md says why this one).
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FURNITURE_LABELS, TYPICAL_ITEMS, type FurnitureLabel } from "../src/shared/furniture";
import { parseModelLibrary, type ModelLibrary } from "../src/shared/model-library";
import { glbBounds, materialNames, normaliseModel, readGlb, writeGlb, type GltfJson } from "../src/viewer/glb";

const PACK = {
  name: "Furniture Kit 2.0",
  url: "https://kenney.nl/assets/furniture-kit",
  licence: "CC0 1.0",
  licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  credit: "Furniture Kit by Kenney (www.kenney.nl)",
};

type Choice = {
  /** The model in the kit that stands for the type. */
  source: string;
  /** The material that is the main surface of the piece, so that its colour can be changed (the kit's own name for it). */
  mainMaterial: string;
  /** How far to turn the model about the vertical axis, so that its front faces +z. */
  turnDegrees: 0 | 90 | 180 | 270;
  /** Something to know about the choice, for the index. */
  note?: string;
};

// The models of this kit all face +z already (checked by looking at each of them from the front and
// from behind), so none needs turning. A model from another pack might.
const MODELS: Record<FurnitureLabel, Choice> = {
  sofa: { source: "loungeSofa", mainMaterial: "carpet", turnDegrees: 0 },
  armchair: { source: "loungeChair", mainMaterial: "carpet", turnDegrees: 0 },
  coffee_table: { source: "tableCoffee", mainMaterial: "wood", turnDegrees: 0 },
  side_table: { source: "sideTable", mainMaterial: "wood", turnDegrees: 0, note: "A long, narrow table rather than a square one." },
  dining_table: { source: "table", mainMaterial: "wood", turnDegrees: 0 },
  dining_chair: { source: "chair", mainMaterial: "wood", turnDegrees: 0 },
  bed: { source: "bedDouble", mainMaterial: "carpet", turnDegrees: 0 },
  nightstand: { source: "cabinetBedDrawer", mainMaterial: "wood", turnDegrees: 0 },
  dresser: {
    source: "cabinetTelevisionDoors",
    mainMaterial: "wood",
    turnDegrees: 0,
    note: "Stands in for a chest of drawers, which the kit does not have: a low wooden cabinet with doors.",
  },
  bookshelf: { source: "bookcaseOpen", mainMaterial: "wood", turnDegrees: 0 },
  tv_stand: { source: "cabinetTelevision", mainMaterial: "wood", turnDegrees: 0 },
  desk: { source: "desk", mainMaterial: "wood", turnDegrees: 0 },
  office_chair: { source: "chairDesk", mainMaterial: "carpet", turnDegrees: 0 },
  floor_lamp: { source: "lampRoundFloor", mainMaterial: "lamp", turnDegrees: 0 },
  rug: { source: "rugRectangle", mainMaterial: "carpet", turnDegrees: 0 },
};

type Size = { width: number; depth: number; height: number };

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** The size of a model in cm, as the scene shows it: width along x, height along y, depth along z. */
function sizeCm(json: GltfJson): Size {
  const { min, max } = glbBounds(json);
  return { width: (max.x - min.x) * 100, height: (max.y - min.y) * 100, depth: (max.z - min.z) * 100 };
}

/**
 * The even scale that brings a model as close as it can get to the typical size of its type: the
 * geometric mean of the three ratios, so that being too big on one side and too small on another
 * cancel out. Rounded to two decimals.
 */
function fitScale(model: Size, typical: Size): number {
  const logs = (["width", "depth", "height"] as const).map((side) => Math.log(typical[side] / model[side]));
  return round(Math.exp(logs.reduce((sum, log) => sum + log, 0) / logs.length), 2);
}

async function main() {
  const kit = process.argv[2];
  if (!kit) {
    console.error("Usage: npm run models -- <the unpacked Furniture Kit folder>");
    process.exit(1);
  }
  const output = join(process.cwd(), "public", "models");
  await mkdir(output, { recursive: true });

  const models: ModelLibrary["models"] = [];
  for (const type of FURNITURE_LABELS) {
    const choice = MODELS[type];
    const { json, binary } = readGlb(new Uint8Array(await readFile(join(kit, "Models", "GLTF format", `${choice.source}.glb`))));

    const typical = TYPICAL_ITEMS[type];
    const scale = fitScale(
      sizeCm(normaliseModel(json, { name: type, scale: 1, turnDegrees: choice.turnDegrees })),
      { width: typical.width_cm, depth: typical.depth_cm, height: typical.height_cm },
    );
    const model = normaliseModel(json, { name: type, scale, turnDegrees: choice.turnDegrees });
    model.asset.copyright = `${PACK.credit}, ${PACK.licence}`;
    const size = sizeCm(model);

    const file = `${type}.glb`;
    await writeFile(join(output, file), writeGlb({ json: model, binary }));

    const turn = choice.turnDegrees === 0 ? "" : `, turned ${choice.turnDegrees} degrees so that it faces +z`;
    models.push({
      type,
      file,
      width_cm: round(size.width, 1),
      depth_cm: round(size.depth, 1),
      height_cm: round(size.height, 1),
      main_material: choice.mainMaterial,
      materials: [...new Set(materialNames(json).filter((name) => name !== ""))],
      licence: PACK.licence,
      licence_url: PACK.licenceUrl,
      credit: PACK.credit,
      credit_required: false,
      source: { name: choice.source, pack: PACK.name, url: PACK.url },
      changes: `Scaled by ${scale}, and moved so that its base is on the floor and the middle of its footprint is at the origin${turn}.${choice.note ? ` ${choice.note}` : ""}`,
    });
    console.log(
      `${type.padEnd(13)} ${choice.source.padEnd(24)} x${String(scale).padEnd(5)} ${round(size.width, 0)} x ${round(size.depth, 0)} x ${round(size.height, 0)} cm`,
    );
  }

  const library: ModelLibrary = {
    about:
      "The furniture models of the 3D room: at least one for each type the app supports. Made from the packs named under source by scripts/build-model-library.ts, which is also how to change them.",
    conventions: {
      units: "Sizes here are in cm. The files themselves are in metres, as glTF requires.",
      size: "width_cm (along x), depth_cm (along z) and height_cm (along y) are the size of the model as its file loads it. To show a piece at another size, scale the model along each axis by the size wanted divided by the size given here.",
      origin: "The middle of the model's footprint is at x = 0, z = 0 and its base is at y = 0, so a model stands on the floor wherever it is put.",
      facing: "Every model faces +z, the front of the room, when it is not turned.",
    },
    models,
  };
  // The same check the app makes, so that a library that the app would refuse is not written.
  parseModelLibrary(library);
  await writeFile(join(output, "index.json"), `${JSON.stringify(library, null, 2)}\n`);
  await writeFile(join(output, "LICENSE-kenney-furniture-kit.txt"), await readFile(join(kit, "License.txt")));

  // Models from an earlier run that are no longer in the library.
  const kept = new Set(models.map((model) => model.file));
  for (const name of await readdir(output)) {
    if (name.endsWith(".glb") && !kept.has(name)) {
      await rm(join(output, name));
      console.log(`removed ${name}`);
    }
  }
  console.log(`\n${models.length} models written to public/models`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
