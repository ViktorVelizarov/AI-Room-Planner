// AI module: furniture detection and layout generation (Gemini).
// Server-side only. Must not import anything from ../viewer.
export { DetectionError, detectFurniture } from "./detect";
export { MissingApiKeyError } from "./gemini";
export type { DetectionImage, DetectionResult, TokenUsage } from "./types";
