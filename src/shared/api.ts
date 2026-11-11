import type { FurnitureItem } from "./furniture";
import type { Pose } from "./layout";
import type { LayoutStyle } from "./layout-styles";
import type { RoomDescription } from "./room-description";

/** AI calls made so far in this session, and the most that are allowed. */
export type Calls = { used: number; limit: number };

export type ApiErrorCode =
  | "invalid_photo"
  | "photo_too_large"
  | "invalid_description"
  | "invalid_request"
  | "limit_reached"
  | "room_too_full"
  | "invalid_answer"
  | "layout_has_overlaps"
  | "too_similar"
  | "timed_out"
  | "ai_unavailable"
  | "server_misconfigured";

/** Body of a successful POST /api/detect response. */
export type DetectResponse = {
  items: FurnitureItem[];
  /** Things the AI found that are not a supported furniture type. They are not in `items`. */
  unsupported: number;
  calls: Calls;
};

/** A layout in one style (US-21): where each piece goes, and what the layout is about. */
export type StyledLayout = {
  style: LayoutStyle;
  ok: true;
  /** The name of the style, for the user. */
  name: string;
  /** The idea of the layout in a sentence or two, for the user. */
  description: string;
  /** Where each piece goes, in the order of the furniture list that was sent. */
  poses: Pose[];
  /** The pieces that the app moved, by their places in the list, so that nothing overlaps or goes through a wall. */
  adjusted: number[];
};

/** Why one style has no layout, when the others may have one. */
export type StyleFailureCode = "invalid_answer" | "layout_has_overlaps" | "too_similar" | "limit_reached" | "timed_out" | "ai_unavailable";

/** A style that has no layout. The message is safe to show to the user. */
export type StyleFailure = {
  style: LayoutStyle;
  ok: false;
  name: string;
  code: StyleFailureCode;
  message: string;
};

export type StyleResult = StyledLayout | StyleFailure;

/** Body of a POST /api/layout request: the room, and which styles to make. */
export type LayoutsRequestBody = {
  description: RoomDescription;
  /** The styles to make, in the order they are wanted; all of them if there is none. */
  styles?: LayoutStyle[];
  /** Layouts of this room that are already made, which the new ones have to differ from (when one style is made again). */
  existing?: { style: LayoutStyle; poses: Pose[] }[];
};

/**
 * Body of a successful POST /api/layout response: an answer for each style that was asked for, in the
 * order it was asked for, with at least one layout among them.
 */
export type LayoutsResponse = {
  results: StyleResult[];
  calls: Calls;
};

/** Body of every failed API response. `message` is safe to show to the user. */
export type ApiFailure = {
  error: { code: ApiErrorCode; message: string };
  calls: Calls;
};
