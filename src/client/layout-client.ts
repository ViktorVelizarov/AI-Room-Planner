import type { ApiErrorCode, ApiFailure, Calls, LayoutsRequestBody, LayoutsResponse, StyleFailureCode, StyleResult } from "../shared/api";
import type { Pose } from "../shared/layout";
import { LAYOUT_STYLES, isLayoutStyle, type LayoutStyle } from "../shared/layout-styles";
import type { RoomDescription } from "../shared/room-description";

export type LayoutFailure = {
  code: ApiErrorCode | "network";
  /** Written for the user. */
  message: string;
  /** Whether asking again can help. */
  retryable: boolean;
  /** The session's AI calls, when the server said. */
  calls?: Calls;
};

export type LayoutOutcome =
  | { ok: true; data: LayoutsResponse }
  | { ok: false; failure: LayoutFailure };

/** Errors that come from the AI side and may not happen again. The rest need the user to change something. */
const RETRYABLE: ApiErrorCode[] = ["invalid_answer", "layout_has_overlaps", "too_similar", "timed_out", "ai_unavailable"];

const STYLE_FAILURE_CODES: StyleFailureCode[] = ["invalid_answer", "layout_has_overlaps", "too_similar", "limit_reached", "timed_out", "ai_unavailable"];

// The server makes the styles at the same time, each with up to two calls to Gemini, and may make one of them
// once more: that is up to two rounds of two calls one after the other, each call with a deadline of its own that
// is at most 150 s (GEMINI_LAYOUT_TIMEOUT_S). So the server ends a request on its own long before this, which only
// keeps a request from hanging for ever.
const REQUEST_TIMEOUT_MS = 600_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPose = (value: unknown): value is Pose =>
  isObject(value) &&
  [value.x_m, value.z_m, value.rotation_deg].every((number) => Number.isFinite(number));

/** A result for a style: a layout with a place for every piece that was sent, or a failure with its message. */
const isStyleResult = (value: unknown, pieces: number): value is StyleResult => {
  if (!isObject(value) || !isLayoutStyle(value.style) || typeof value.name !== "string") return false;
  if (value.ok === false) {
    return STYLE_FAILURE_CODES.includes(value.code as StyleFailureCode) && typeof value.message === "string";
  }
  return (
    value.ok === true &&
    typeof value.description === "string" &&
    Array.isArray(value.poses) &&
    value.poses.length === pieces &&
    value.poses.every(isPose) &&
    Array.isArray(value.adjusted) &&
    value.adjusted.every((index) => Number.isInteger(index) && index >= 0 && index < pieces)
  );
};

/**
 * A response that has an answer for each style that was asked for, in order, once each, with at least
 * one layout among them.
 */
const isLayoutsResponse = (body: unknown, pieces: number, styles: readonly LayoutStyle[]): body is LayoutsResponse =>
  isObject(body) &&
  Array.isArray(body.results) &&
  body.results.length === styles.length &&
  body.results.every((result, index) => isStyleResult(result, pieces) && result.style === styles[index]) &&
  body.results.some((result) => result.ok === true) &&
  isObject(body.calls);

const isApiFailure = (body: unknown): body is ApiFailure =>
  isObject(body) &&
  isObject(body.error) &&
  typeof body.error.code === "string" &&
  typeof body.error.message === "string";

type Options = {
  /** Sends the request. Replaced in tests. */
  send?: (url: string, init: RequestInit) => Promise<Response>;
};

/** What to ask for besides the room. */
export type LayoutChoice = {
  /** The styles to make, in order; all three if there are none. */
  styles?: readonly LayoutStyle[];
  /** Layouts that are already made, which the new ones have to differ from. */
  existing?: readonly { style: LayoutStyle; poses: readonly Pose[] }[];
};

/**
 * Sends the room description to /api/layout and returns either a layout in each style that was asked
 * for (some of them may have failed, and say why) or a failure with a message that can be shown as it
 * is. Never throws.
 */
export async function requestLayout(
  description: RoomDescription,
  { styles, existing }: LayoutChoice = {},
  { send = (url, init) => fetch(url, init) }: Options = {},
): Promise<LayoutOutcome> {
  const fail = (failure: LayoutFailure): LayoutOutcome => ({ ok: false, failure });

  const chosen = styles && styles.length > 0 ? [...styles] : undefined;
  const asked = chosen ?? [...LAYOUT_STYLES];
  const body: LayoutsRequestBody = {
    description,
    ...(chosen ? { styles: chosen } : {}),
    ...(existing && existing.length > 0 ? { existing: existing.map(({ style, poses }) => ({ style, poses: [...poses] })) } : {}),
  };

  let response: Response;
  try {
    response = await send("/api/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return fail({
      code: "network",
      message: timedOut
        ? "This is taking longer than expected. Please try again."
        : "We could not reach the server. Check your internet connection and try again.",
      retryable: true,
    });
  }

  const json: unknown = await response.json().catch(() => null);

  if (response.ok && isLayoutsResponse(json, description.furniture.length, asked)) return { ok: true, data: json };

  if (isApiFailure(json)) {
    return fail({
      code: json.error.code,
      message: json.error.message,
      retryable: RETRYABLE.includes(json.error.code),
      calls: isObject(json.calls) ? json.calls : undefined,
    });
  }

  return fail({
    code: "ai_unavailable",
    message: "Something went wrong on our side. Please try again.",
    retryable: true,
  });
}
