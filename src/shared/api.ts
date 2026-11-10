import type { FurnitureItem } from "./furniture";
import type { Pose } from "./layout";

/** AI calls made so far in this session, and the most that are allowed. */
export type Calls = { used: number; limit: number };

export type ApiErrorCode =
  | "invalid_photo"
  | "photo_too_large"
  | "invalid_description"
  | "limit_reached"
  | "room_too_full"
  | "invalid_answer"
  | "layout_has_overlaps"
  | "ai_unavailable"
  | "server_misconfigured";

/** Body of a successful POST /api/detect response. */
export type DetectResponse = {
  items: FurnitureItem[];
  /** Things the AI found that are not a supported furniture type. They are not in `items`. */
  unsupported: number;
  calls: Calls;
};

/** Body of a successful POST /api/layout response. */
export type LayoutResponse = {
  /** Where each piece goes, in the order of the furniture list that was sent. */
  layout: Pose[];
  /** The pieces that the app moved, by their places in the list, so that nothing overlaps or goes through a wall. */
  adjusted: number[];
  calls: Calls;
};

/** Body of every failed API response. `message` is safe to show to the user. */
export type ApiFailure = {
  error: { code: ApiErrorCode; message: string };
  calls: Calls;
};
