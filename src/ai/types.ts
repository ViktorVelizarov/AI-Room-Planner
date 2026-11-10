import type { FurnitureItem } from "../shared/furniture";
import type { Pose } from "../shared/layout";
import type { PhotoType } from "../shared/photo";
import type { RoomDescription } from "../shared/room-description";

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

/** One call to the model, with every photo of the room. Injected into `detectFurniture` so tests need no network. */
export type GenerateFn = (images: DetectionImage[]) => Promise<ModelAnswer>;

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

/** What one call to the model for a layout is given. */
export type LayoutRequest = {
  description: RoomDescription;
  /** Why the answer before this one could not be used, when this is the second try. */
  feedback?: string;
};

/** One call to the model for a layout. Injected into `generateLayout` so tests need no network. */
export type GenerateLayoutFn = (request: LayoutRequest) => Promise<ModelAnswer>;

export type LayoutResult = {
  /** Where each piece goes, in the order of the furniture list. */
  poses: Pose[];
  /** The pieces that the app moved, by their places in the list, to stop them overlapping or going through a wall. */
  adjusted: number[];
  /** Model calls made: 1, or 2 when the first answer was invalid. Each one is a paid call. */
  attempts: number;
  /** Tokens used, summed over all attempts. */
  usage: TokenUsage;
};
