import type { FurnitureItem } from "../shared/furniture";
import type { PhotoType } from "../shared/photo";

export type DetectionImage = {
  /** Base64-encoded image bytes. */
  data: string;
  mimeType: PhotoType;
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

/** What one call to the model returns, before any validation. */
export type ModelAnswer = {
  text: string | undefined;
  usage?: TokenUsage;
  /** Why the answer may be unusable (blocked, cut off). Only used in error messages. */
  note?: string;
};

/** One call to the model. Injected into `detectFurniture` so tests need no network. */
export type GenerateFn = (image: DetectionImage) => Promise<ModelAnswer>;

export type DetectionResult = {
  /** The furniture found, supported types only. */
  items: FurnitureItem[];
  /** Items the model found that are not a supported type. They are left out of `items`. */
  unsupported: number;
  /** Model calls made: 1, or 2 when the first answer was invalid. Each one is a paid call. */
  attempts: number;
  /** Tokens used, summed over all attempts. */
  usage: TokenUsage;
};
