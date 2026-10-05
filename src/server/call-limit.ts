import "server-only";
import type { Calls } from "../shared/api";

export const DEFAULT_CALL_LIMIT = 10;
export const CALLS_COOKIE = "ai_calls";

/** AI calls allowed per session: AI_CALL_LIMIT if it is a whole number of 0 or more, else the default. */
export function getCallLimit(value = process.env.AI_CALL_LIMIT): number {
  if (!value?.trim()) return DEFAULT_CALL_LIMIT;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_CALL_LIMIT;
}

/** Calls made so far in this session, read from the request's cookie. A missing or unreadable cookie means a new session. */
export function readCalls(request: Request, limit: number): Calls {
  const cookie = request.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${CALLS_COOKIE}=(\\d+)(?:;|$)`).exec(cookie);
  return { used: match ? Number(match[1]) : 0, limit };
}

/** Set-Cookie value that keeps the count for the rest of the browser session. */
export function callsCookie(calls: Calls): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CALLS_COOKIE}=${calls.used}; Path=/api; HttpOnly; SameSite=Lax${secure}`;
}

export class CallLimitError extends Error {
  readonly calls: Calls;

  constructor(calls: Calls) {
    super(`AI call limit of ${calls.limit} reached`);
    this.name = "CallLimitError";
    this.calls = calls;
  }
}

/**
 * Wraps one model call so that it is counted first and never sent once the limit is
 * reached. The count goes up before the call, so a call that fails or times out still
 * counts. Updates `calls` in place.
 */
export function limitCalls<Args extends unknown[], Result>(
  call: (...args: Args) => Promise<Result>,
  calls: Calls,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    if (calls.used >= calls.limit) throw new CallLimitError({ ...calls });
    calls.used += 1;
    return call(...args);
  };
}
