// AI module: furniture detection and layout generation (Gemini).
// Server-side only. Must not import anything from ../viewer.
export { DetectionError, detectFurniture } from "./detect";
export { LayoutError, LayoutOverlapError, RoomTooFullError, generateLayout } from "./layout";
export { MissingApiKeyError, generateLayoutWithGemini, generateWithGemini } from "./gemini";
export type {
  DetectionImage,
  DetectionResult,
  GenerateFn,
  GenerateLayoutFn,
  LayoutRequest,
  LayoutResult,
  ModelAnswer,
  TokenUsage,
} from "./types";
