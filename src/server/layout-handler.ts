import "server-only";
import {
  AiTimeoutError,
  MissingApiKeyError,
  RoomTooFullError,
  generateLayouts,
  generateLayoutWithGemini,
  type GenerateLayoutFn,
  type StyleOutcome,
} from "../ai";
import type { ApiErrorCode, ApiFailure, LayoutsResponse, StyleFailure, StyleFailureCode, StyleResult } from "../shared/api";
import { STYLE_NAMES, type LayoutStyle } from "../shared/layout-styles";
import { checkLayoutsRequest } from "../shared/layouts-request";
import {
  CallLimitError,
  callsCookie,
  getCallLimit,
  limitCalls,
  limitMessage,
  readCalls,
} from "./call-limit";

// A room description with the most pieces there can be is a few kilobytes, and so are the layouts that are already made.
const MAX_BODY_BYTES = 64 * 1024;

type Options = {
  /** The model call. Replaced in tests so they need no network. */
  generate?: GenerateLayoutFn;
  getLimit?: () => number;
};

/** What a style that has no layout is told, for the user: the cause, in a sentence. The details stay in the server log. */
function styleFailureMessage(style: LayoutStyle, failure: StyleFailureCode, calls: { limit: number }, similar?: { own: number; needed: number; pieces: number }): string {
  const name = STYLE_NAMES[style];
  switch (failure) {
    case "invalid_answer":
      return `The AI could not make a usable ${name} layout this time.`;
    case "layout_has_overlaps":
      return `The ${name} layout that the AI made still had furniture overlapping after the app tried to fix it.`;
    case "too_similar":
      return similar
        ? `The ${name} layout was too much like the others: only ${similar.own} of ${similar.pieces} pieces ${similar.own === 1 ? "was" : "were"} in a different place, and at least ${similar.needed} ${similar.needed === 1 ? "is" : "are"} needed.`
        : `The ${name} layout was too much like the others.`;
    case "limit_reached":
      return limitMessage(calls.limit);
    case "timed_out":
      return `The AI took too long to make the ${name} layout. Please try again.`;
    case "ai_unavailable":
      return `The AI service was not available for the ${name} layout. Please try again in a moment.`;
  }
}

/** The code of a style that has no layout, from what happened. A failure of the call itself is told apart here, where the session's limit and the key are known. */
function failureCode(outcome: Extract<StyleOutcome, { ok: false }>): StyleFailureCode | "server_misconfigured" {
  const { failure } = outcome;
  if (failure.code !== "error") return failure.code;
  if (failure.error instanceof CallLimitError) return "limit_reached";
  if (failure.error instanceof AiTimeoutError) return "timed_out";
  if (failure.error instanceof MissingApiKeyError) return "server_misconfigured";
  return "ai_unavailable";
}

/** What goes in the server log about a style that has no layout, and not to the user. */
function logFailure(outcome: Extract<StyleOutcome, { ok: false }>) {
  const { style, failure } = outcome;
  switch (failure.code) {
    case "invalid_answer":
      console.error(`[layout] ${style}: invalid answers from the model:`, failure.reasons);
      break;
    case "layout_has_overlaps":
      console.error(`[layout] ${style}: pieces still overlap after fixing:`, failure.problems);
      break;
    case "too_similar":
      console.error(`[layout] ${style}: too like the other layouts: ${failure.own} of ${failure.pieces} pieces in places of their own, ${failure.needed} needed.`);
      break;
    case "error":
      if (failure.error instanceof CallLimitError) break;
      if (failure.error instanceof AiTimeoutError) {
        console.error(`[layout] ${style}: ${failure.error.message}`, failure.error.cause);
        break;
      }
      if (failure.error instanceof MissingApiKeyError) console.error("[layout]", failure.error.message);
      else console.error(`[layout] ${style}: the model call failed:`, failure.error);
  }
}

/**
 * Builds the POST handler for /api/layout: a room description in (the room size and the furniture
 * list), with the styles to make (all three if none are given), and a layout in each style out (a
 * place and a turn for every piece, in the order of the list, with the name of the style and a
 * description of its idea). The styles are made at the same time, with one count of the session's
 * model calls that all of them share, and each succeeds or fails on its own: the answer has a result
 * for each style, as long as at least one style has a layout. If none has, the answer is an error, as
 * it was for a single layout. A request that is over the limit, is not valid, or is for a room that
 * cannot hold its furniture is answered before anything is sent to the AI provider. Error messages are
 * written for the user; details (provider errors, keys, what was wrong with an answer) stay in the
 * server log.
 */
export function createLayoutHandler({
  generate = generateLayoutWithGemini,
  getLimit = getCallLimit,
}: Options = {}) {
  return async function POST(request: Request): Promise<Response> {
    const calls = readCalls(request, getLimit());
    const callsAtStart = calls.used;

    const respond = (body: LayoutsResponse | ApiFailure, status: number) => {
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

    const checked = checkLayoutsRequest(body);
    if (!checked.ok) {
      return fail("invalid_request", `The request is not valid. ${checked.problems.join(" ")}`, 400);
    }

    let outcomes: StyleOutcome[];
    try {
      outcomes = await generateLayouts(checked.request.description, checked.request.styles, limitCalls(generate, calls), checked.request.existing);
    } catch (error) {
      if (error instanceof RoomTooFullError) {
        return fail("room_too_full", error.message, 422);
      }
      console.error("[layout] the layouts could not be made:", error);
      return fail("ai_unavailable", "The AI service is not available right now. Please try again in a moment.", 503);
    }

    for (const outcome of outcomes) {
      if (!outcome.ok) logFailure(outcome);
      else if (!outcome.described) console.warn(`[layout] ${outcome.style}: the answer had no description that could be used, so the layout has the idea of its style.`);
    }

    const results = outcomes.map((outcome): StyleResult => {
      const name = STYLE_NAMES[outcome.style];
      if (outcome.ok) return { style: outcome.style, ok: true, name, description: outcome.description, poses: outcome.poses, adjusted: outcome.adjusted };
      const code = failureCode(outcome);
      // A style that cannot be made because of the key is told like one whose service is down; the key is the whole request's problem, handled below.
      const shown: StyleFailureCode = code === "server_misconfigured" ? "ai_unavailable" : code;
      const similar = outcome.failure.code === "too_similar" ? outcome.failure : undefined;
      return { style: outcome.style, ok: false, name, code: shown, message: styleFailureMessage(outcome.style, shown, calls, similar) } satisfies StyleFailure;
    });
    if (results.some((result) => result.ok)) return respond({ results, calls: { ...calls } }, 200);

    // No layout at all: an error for the whole request, as for a single layout. What is told is the cause that matters most.
    const codes = outcomes.map((outcome) => (outcome.ok ? null : failureCode(outcome)));
    if (codes.includes("server_misconfigured")) return fail("server_misconfigured", "The server is not set up for AI requests yet.", 500);
    if (codes.every((code) => code === "limit_reached")) return fail("limit_reached", limitMessage(calls.limit), 429);
    if (codes.includes("ai_unavailable")) return fail("ai_unavailable", "The AI service is not available right now. Please try again in a moment.", 503);
    if (codes.includes("timed_out")) return fail("timed_out", "The AI took too long to make the layouts. Please try again.", 504);
    const first = results.find((result) => !result.ok && result.code !== "limit_reached") as StyleFailure;
    if (first.code === "too_similar") return fail("too_similar", first.message, 502);
    if (first.code === "layout_has_overlaps") {
      return fail(
        "layout_has_overlaps",
        "The layout that the AI made still had furniture overlapping after the app tried to fix it. Please try again, or check the size of the room and of the furniture.",
        502,
      );
    }
    return fail("invalid_answer", "The AI could not make a usable layout this time. Please try again.", 502);
  };
}
