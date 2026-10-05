import type { FurnitureItem } from "./furniture";

/** AI calls made so far in this session, and the most that are allowed. */
export type Calls = { used: number; limit: number };

export type ApiErrorCode =
  | "invalid_photo"
  | "photo_too_large"
  | "limit_reached"
  | "invalid_answer"
  | "ai_unavailable"
  | "server_misconfigured";

/** Body of a successful POST /api/detect response. */
export type DetectResponse = {
  items: FurnitureItem[];
  /** Things the AI found that are not a supported furniture type. They are not in `items`. */
  unsupported: number;
  calls: Calls;
};

/** Body of every failed API response. `message` is safe to show to the user. */
export type ApiFailure = {
  error: { code: ApiErrorCode; message: string };
  calls: Calls;
};
