// AI module: furniture detection and layout generation (Gemini).
// Server-side only. Must not import anything from ../viewer.
export { DetectionError, detectFurniture } from "./detect";
export { LayoutError, LayoutOverlapError, RoomTooFullError, generateLayout } from "./layout";
export { generateLayouts, type StyleFailure, type StyleOutcome } from "./layouts";
export { AiTimeoutError, MissingApiKeyError, generateLayoutWithGemini, generateWithGemini } from "./gemini";
export type {
  DetectionImage,
  DetectionResult,
  GenerateFn,
  GenerateLayoutFn,
  LayoutOptions,
  LayoutRequest,
  LayoutResult,
  ModelAnswer,
  TokenUsage,
} from "./types";
