import "server-only";
import {
  LayoutError,
  LayoutOverlapError,
  MissingApiKeyError,
  RoomTooFullError,
  generateLayout,
  generateLayoutWithGemini,
  type GenerateLayoutFn,
} from "../ai";
import type { ApiErrorCode, ApiFailure, LayoutResponse } from "../shared/api";
import { checkLayoutRequest } from "../shared/layout";
import {
  CallLimitError,
  callsCookie,
  getCallLimit,
  limitCalls,
  limitMessage,
  readCalls,
} from "./call-limit";

// A room description with the most pieces there can be is a few kilobytes.
const MAX_BODY_BYTES = 64 * 1024;

type Options = {
  /** The model call. Replaced in tests so they need no network. */
  generate?: GenerateLayoutFn;
  getLimit?: () => number;
};

/**
 * Builds the POST handler for /api/layout: a room description in (the room size and the furniture
 * list), a layout out (a place and a turn for every piece, in the order of the list). Every model
 * call is counted against the session's limit, and a request that is over the limit, is not a
 * valid description, or is for a room that cannot hold its furniture is answered before anything is
 * sent to the AI provider. Error messages are written for the user; details (provider errors,
 * keys, what was wrong with an answer) stay in the server log.
 */
export function createLayoutHandler({
  generate = generateLayoutWithGemini,
  getLimit = getCallLimit,
}: Options = {}) {
  return async function POST(request: Request): Promise<Response> {
    const calls = readCalls(request, getLimit());
    const callsAtStart = calls.used;

    const respond = (body: LayoutResponse | ApiFailure, status: number) => {
      const headers = new Headers({ "Cache-Control": "no-store" });
      // Only when calls were made: otherwise the browser already has the right value.
      if (calls.used !== callsAtStart) {
        headers.append("Set-Cookie", callsCookie(calls));
      }
      return Response.json(body, { status, headers });
    };
    const fail = (code: ApiErrorCode, message: string, status: number) =>
      respond({ error: { code, message }, calls: { ...calls } }, status);

    // Cheapest check first: no need to read a request for a session that is used up.
    if (calls.used >= calls.limit) {
      return fail("limit_reached", limitMessage(calls.limit), 429);
    }

    const tooLarge = () => fail("invalid_description", "The room description is too large.", 413);
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return tooLarge();

    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return tooLarge();
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }

    const checked = checkLayoutRequest(body);
    if (!checked.ok) {
      return fail("invalid_description", `The room description is not valid. ${checked.problems.join(" ")}`, 400);
    }

    try {
      const result = await generateLayout(checked.description, limitCalls(generate, calls));
      return respond({ layout: result.poses, adjusted: result.adjusted, calls: { ...calls } }, 200);
    } catch (error) {
      if (error instanceof CallLimitError) {
        return fail("limit_reached", limitMessage(calls.limit), 429);
      }
      if (error instanceof RoomTooFullError) {
        return fail("room_too_full", error.message, 422);
      }
      if (error instanceof LayoutError) {
        console.error("[layout] invalid answers from the model:", error.reasons);
        return fail(
          "invalid_answer",
          "The AI could not make a usable layout this time. Please try again.",
          502,
        );
      }
      if (error instanceof LayoutOverlapError) {
        console.error("[layout] pieces still overlap after fixing:", error.problems);
        return fail(
          "layout_has_overlaps",
          "The layout that the AI made still had furniture overlapping after the app tried to fix it. Please try again, or check the size of the room and of the furniture.",
          502,
        );
      }
      if (error instanceof MissingApiKeyError) {
        console.error("[layout]", error.message);
        return fail(
          "server_misconfigured",
          "The server is not set up for AI requests yet.",
          500,
        );
      }
      console.error("[layout] the model call failed:", error);
      return fail(
        "ai_unavailable",
        "The AI service is not available right now. Please try again in a moment.",
        503,
      );
    }
  };
}
