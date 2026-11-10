import type { ApiErrorCode, ApiFailure, Calls, LayoutResponse } from "../shared/api";
import type { Pose } from "../shared/layout";
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
  | { ok: true; data: LayoutResponse }
  | { ok: false; failure: LayoutFailure };

/** Errors that come from the AI side and may not happen again. The rest need the user to change something. */
const RETRYABLE: ApiErrorCode[] = ["invalid_answer", "layout_has_overlaps", "ai_unavailable"];

// The server may make two calls to Gemini of up to 60 s each.
const REQUEST_TIMEOUT_MS = 150_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPose = (value: unknown): value is Pose =>
  isObject(value) &&
  [value.x_m, value.z_m, value.rotation_deg].every((number) => Number.isFinite(number));

/** A response that has a place for every piece that was sent, and says which were moved. */
const isLayoutResponse = (body: unknown, pieces: number): body is LayoutResponse =>
  isObject(body) &&
  Array.isArray(body.layout) &&
  body.layout.length === pieces &&
  body.layout.every(isPose) &&
  Array.isArray(body.adjusted) &&
  body.adjusted.every((index) => Number.isInteger(index) && index >= 0 && index < pieces) &&
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

/**
 * Sends the room description to /api/layout and returns either the layout or a failure with a
 * message that can be shown as it is. Never throws.
 */
export async function requestLayout(
  description: RoomDescription,
  { send = (url, init) => fetch(url, init) }: Options = {},
): Promise<LayoutOutcome> {
  const fail = (failure: LayoutFailure): LayoutOutcome => ({ ok: false, failure });

  let response: Response;
  try {
    response = await send("/api/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(description),
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

  const body: unknown = await response.json().catch(() => null);

  if (response.ok && isLayoutResponse(body, description.furniture.length)) return { ok: true, data: body };

  if (isApiFailure(body)) {
    return fail({
      code: body.error.code,
      message: body.error.message,
      retryable: RETRYABLE.includes(body.error.code),
      calls: isObject(body.calls) ? body.calls : undefined,
    });
  }

  return fail({
    code: "ai_unavailable",
    message: "Something went wrong on our side. Please try again.",
    retryable: true,
  });
}
