import { describe, expect, it } from "vitest";
import { FURNITURE_LABELS, type FurnitureLabel } from "./furniture";
import { parseModelLibrary, typesWithoutModel, type ModelEntry } from "./model-library";

const entry = (type: FurnitureLabel, changes: Partial<ModelEntry> = {}): ModelEntry => ({
  type,
  file: `${type}.glb`,
  width_cm: 100,
  depth_cm: 50,
  height_cm: 80,
  main_material: "wood",
  materials: ["wood", "metal"],
  licence: "CC0 1.0",
  licence_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  credit: "Furniture Kit by Kenney (www.kenney.nl)",
  credit_required: false,
  source: { name: "chair", pack: "Furniture Kit 2.0", url: "https://kenney.nl/assets/furniture-kit" },
  changes: "Scaled by 2.",
  ...changes,
});

const conventions = { units: "cm", size: "the size of the model", origin: "the middle of the footprint", facing: "+z" };
const library = (models: ModelEntry[] = FURNITURE_LABELS.map((type) => entry(type))) => ({
  about: "The furniture models.",
  conventions,
  models,
});

/** What parsing says is wrong with a library, or "" if it is fine. */
const problemWith = (input: unknown) => {
  try {
    parseModelLibrary(input);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("parseModelLibrary", () => {
  it("accepts a library that has a model for every supported type, and returns it", () => {
    const parsed = parseModelLibrary(library());

    expect(parsed.models).toHaveLength(FURNITURE_LABELS.length);
    expect(parsed.models[0]).toEqual(entry("sofa"));
  });

  it("accepts more than one model for a type", () => {
    const models = [...FURNITURE_LABELS.map((type) => entry(type)), entry("sofa", { file: "sofa_long.glb" })];

    expect(parseModelLibrary(library(models)).models.filter((model) => model.type === "sofa")).toHaveLength(2);
  });

  it("says which types have no model, in the order of the supported types, and that it is not valid", () => {
    const models = FURNITURE_LABELS.filter((type) => type !== "bed" && type !== "sofa").map((type) => entry(type));

    const problem = problemWith(library(models));

    expect(problem).toContain("The furniture library index is not valid.");
    expect(problem).toContain("there is no model for: sofa, bed");
  });

  it("refuses a library with no models at all", () => {
    expect(problemWith(library([]))).toContain("models");
  });

  it("refuses a model of a type that is not supported", () => {
    const models = [...FURNITURE_LABELS.map((type) => entry(type)), { ...entry("sofa"), type: "chaise", file: "chaise.glb" }];

    expect(problemWith(library(models as ModelEntry[]))).toContain("models.15.type");
  });

  it.each(["../sofa.glb", "models/sofa.glb", "models\\sofa.glb", "sofa.gltf", "Sofa.glb", "sofa", ".glb", ""])(
    "refuses %j as a file name, because it is not a plain name of a GLB file",
    (file) => {
      const models = FURNITURE_LABELS.map((type) => (type === "sofa" ? entry(type, { file }) : entry(type)));

      expect(problemWith(library(models))).toContain("must be a plain file name that ends in .glb");
    },
  );

  it("refuses two models that use the same file", () => {
    const models = [...FURNITURE_LABELS.map((type) => entry(type)), entry("armchair", { file: "sofa.glb" })];

    expect(problemWith(library(models))).toContain("sofa.glb is used by more than one model");
  });

  it.each([0, -5, NaN, Infinity * 0])("refuses %s as a size", (value) => {
    for (const side of ["width_cm", "depth_cm", "height_cm"] as const) {
      const models = FURNITURE_LABELS.map((type) => (type === "rug" ? entry(type, { [side]: value }) : entry(type)));

      expect(problemWith(library(models)), side).toContain(`models.14.${side}`);
    }
  });

  it("refuses a model without a licence or a credit, even if they are only spaces", () => {
    for (const field of ["licence", "credit", "changes", "main_material"] as const) {
      const models = FURNITURE_LABELS.map((type) => (type === "desk" ? entry(type, { [field]: "   " }) : entry(type)));

      expect(problemWith(library(models)), field).toContain(`models.11.${field}`);
    }
  });

  it("refuses a licence address or a source address that is not an address", () => {
    const badLicence = FURNITURE_LABELS.map((type) => (type === "desk" ? entry(type, { licence_url: "CC0" }) : entry(type)));
    const badSource = FURNITURE_LABELS.map((type) =>
      type === "desk" ? entry(type, { source: { name: "desk", pack: "Kit", url: "kenney" } }) : entry(type),
    );

    expect(problemWith(library(badLicence))).toContain("models.11.licence_url");
    expect(problemWith(library(badSource))).toContain("models.11.source.url");
  });

  it("refuses a model whose main material is not one of its materials", () => {
    const models = FURNITURE_LABELS.map((type) => (type === "desk" ? entry(type, { main_material: "glass" }) : entry(type)));

    expect(problemWith(library(models))).toContain("must be one of the materials of the model");
  });

  it("refuses a model that does not say whether its credit is required", () => {
    const models = FURNITURE_LABELS.map((type) => (type === "desk" ? { ...entry(type), credit_required: "no" } : entry(type)));

    expect(problemWith(library(models as unknown as ModelEntry[]))).toContain("credit_required");
  });

  it("refuses an index that does not say how to read it", () => {
    const { conventions: _removed, ...noConventions } = library();
    void _removed;

    expect(problemWith(noConventions)).toContain("conventions");
    expect(problemWith({ ...library(), about: "" })).toContain("about");
  });

  it("refuses anything that is not a library", () => {
    for (const input of [null, undefined, 42, "models", [], {}]) {
      expect(problemWith(input), String(input)).toContain("not valid");
    }
  });

  it("lists every problem, not only the first", () => {
    const models = FURNITURE_LABELS.filter((type) => type !== "rug").map((type) => (type === "desk" ? entry(type, { licence: "" }) : entry(type)));

    const problem = problemWith(library(models));

    expect(problem).toContain("licence");
    expect(problem).toContain("there is no model for: rug");
  });
});

describe("typesWithoutModel", () => {
  it("is empty for a complete library, and lists what is missing otherwise", () => {
    expect(typesWithoutModel(library())).toEqual([]);
    expect(typesWithoutModel({ models: [{ type: "sofa" }, { type: "rug" }] })).toEqual(
      FURNITURE_LABELS.filter((type) => type !== "sofa" && type !== "rug"),
    );
    expect(typesWithoutModel({ models: [] })).toEqual([...FURNITURE_LABELS]);
  });
});
