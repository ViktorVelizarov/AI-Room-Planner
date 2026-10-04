import { z } from "zod";
import { FURNITURE_LABELS, furnitureItemSchema } from "../shared/furniture";

/**
 * What the model says for something that matches none of the supported types, so one
 * unsupported item (a TV, a plant) does not make the whole answer invalid. These items are
 * dropped before a result is returned.
 */
export const UNSUPPORTED_LABEL = "other";

const DETECTED_LABELS = [...FURNITURE_LABELS, UNSUPPORTED_LABEL] as const;

const detectedItemSchema = furnitureItemSchema.extend({
  label: z.enum(DETECTED_LABELS),
});

export type DetectedItem = z.infer<typeof detectedItemSchema>;

/** The shape of the model's whole answer. */
export const detectionResponseSchema = z.object({
  items: z.array(detectedItemSchema),
});

/** The same schema as plain JSON Schema, for Gemini's `responseJsonSchema`. */
export function detectionJsonSchema() {
  const schema = z.toJSONSchema(detectionResponseSchema);
  delete schema.$schema; // not in the list of keywords Gemini accepts
  return schema;
}
