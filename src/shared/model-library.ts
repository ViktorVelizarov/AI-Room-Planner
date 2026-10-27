import { z } from "zod";
import { FURNITURE_LABELS, type FurnitureLabel } from "./furniture";

const text = z.string().trim().min(1);
const size = z.number().positive();

/** One model of the furniture library, as the index file lists it. */
export const modelEntrySchema = z
  .object({
    type: z.enum(FURNITURE_LABELS),
    /** The name of the model's file in the library folder: a plain name, never a path. */
    file: z.string().regex(/^[a-z0-9_-]+\.glb$/, "must be a plain file name that ends in .glb"),
    /** The size of the model as its file loads it, in cm: width along x, depth along z, height along y. */
    width_cm: size,
    depth_cm: size,
    height_cm: size,
    /** The material that is the main surface of the piece, by the name it has in the file. */
    main_material: text,
    /** Every material the model uses, by the name it has in the file. */
    materials: z.array(text).min(1),
    licence: text,
    licence_url: z.url(),
    credit: text,
    credit_required: z.boolean(),
    source: z.object({ name: text, pack: text, url: z.url() }),
    /** What was done to the model to make the file. */
    changes: text,
  })
  .refine((entry) => entry.materials.includes(entry.main_material), {
    message: "must be one of the materials of the model",
    path: ["main_material"],
  });

/** The whole index: the models, and how to read them. */
export const modelLibrarySchema = z
  .object({
    about: text,
    conventions: z.object({ units: text, size: text, origin: text, facing: text }),
    models: z.array(modelEntrySchema).min(1),
  })
  .superRefine((library, context) => {
    const missing = typesWithoutModel(library);
    if (missing.length > 0) {
      context.addIssue({ code: "custom", path: ["models"], message: `there is no model for: ${missing.join(", ")}` });
    }
    const seen = new Set<string>();
    for (const [index, model] of library.models.entries()) {
      if (seen.has(model.file)) {
        context.addIssue({ code: "custom", path: ["models", index, "file"], message: `${model.file} is used by more than one model` });
      }
      seen.add(model.file);
    }
  });

export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type ModelLibrary = z.infer<typeof modelLibrarySchema>;

/** The types of furniture that the library has no model for, in the order of the supported types. */
export function typesWithoutModel(library: { models: { type: FurnitureLabel }[] }): FurnitureLabel[] {
  const covered = new Set(library.models.map((model) => model.type));
  return FURNITURE_LABELS.filter((type) => !covered.has(type));
}

/**
 * Checks the library index and returns it. A library that is not complete is not usable, so this
 * throws, with every problem in the message, instead of leaving it to fail later in the 3D scene.
 */
export function parseModelLibrary(input: unknown): ModelLibrary {
  const result = modelLibrarySchema.safeParse(input);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `${issue.path.join(".") || "the index"}: ${issue.message}`);
  throw new Error(`The furniture library index is not valid. ${problems.join("; ")}.`);
}
