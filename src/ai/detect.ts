import { z } from "zod";
import type { FurnitureItem } from "../shared/furniture";
import { generateWithGemini } from "./gemini";
import {
  UNSUPPORTED_LABEL,
  detectionResponseSchema,
  type DetectedItem,
} from "./schema";
import type { DetectionImage, DetectionResult, GenerateFn } from "./types";

/** The first try plus one retry. */
export const MAX_ATTEMPTS = 2;

/** The model's answer was still unusable after the retry, so none of it is used. */
export class DetectionError extends Error {
  readonly attempts: number;
  /** What was wrong with each attempt's answer, in order. */
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super(
      `The model did not return a valid furniture list after ${reasons.length} attempts. Last problem: ${reasons.at(-1)}`,
    );
    this.name = "DetectionError";
    this.attempts = reasons.length;
    this.reasons = reasons;
  }
}

type ParseResult =
  | { ok: true; items: FurnitureItem[]; unsupported: number }
  | { ok: false; reason: string };

function isSupported(item: DetectedItem): item is FurnitureItem {
  return item.label !== UNSUPPORTED_LABEL;
}

/** Checks a raw model answer against the schema. Never throws. */
export function parseDetection(
  text: string | undefined,
  note?: string,
): ParseResult {
  const why = note ? ` (${note})` : "";
  if (!text?.trim()) return { ok: false, reason: `empty answer${why}` };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `not valid JSON${why}: ${detail}` };
  }

  const result = detectionResponseSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, reason: z.prettifyError(result.error) };
  }

  const items = result.data.items.filter(isSupported);
  return {
    ok: true,
    items,
    unsupported: result.data.items.length - items.length,
  };
}

/**
 * Finds the furniture in the photos of one room, all sent in a single model call so that a piece
 * seen in several photos can be listed once. If the model's answer is invalid or incomplete it asks
 * once more; if the second answer is also invalid it throws a DetectionError rather than
 * returning broken data. Errors from the call itself (network, bad key) are not retried.
 */
export async function detectFurniture(
  images: DetectionImage[],
  generate: GenerateFn = generateWithGemini,
): Promise<DetectionResult> {
  if (images.length === 0) throw new RangeError("detectFurniture needs at least one photo");

  const reasons: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const answer = await generate(images);
    usage.inputTokens += answer.usage?.inputTokens ?? 0;
    usage.outputTokens += answer.usage?.outputTokens ?? 0;

    const parsed = parseDetection(answer.text, answer.note);
    if (parsed.ok) {
      return {
        items: parsed.items,
        unsupported: parsed.unsupported,
        attempts: attempt,
        usage,
      };
    }
    reasons.push(parsed.reason);
  }

  throw new DetectionError(reasons);
}
