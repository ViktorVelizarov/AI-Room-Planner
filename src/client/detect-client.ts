import type { ApiErrorCode, ApiFailure, Calls, DetectResponse } from "../shared/api";
import { preparePhoto } from "./resize-photo";

export type DetectFailure = {
  code: ApiErrorCode | "network" | "unreadable_photo";
  /** Written for the user. */
  message: string;
  /** Whether trying the same photos again can help. */
  retryable: boolean;
  /** The session's AI calls, when the server said. */
  calls?: Calls;
};

export type DetectOutcome =
  | { ok: true; data: DetectResponse }
  | { ok: false; failure: DetectFailure };

/** Errors that come from the AI side and may not happen again. The rest need the user to change something. */
const RETRYABLE: ApiErrorCode[] = ["invalid_answer", "ai_unavailable"];

// The server may make two calls to Gemini of up to 60 s each.
const REQUEST_TIMEOUT_MS = 150_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isDetectResponse = (body: unknown): body is DetectResponse =>
  isObject(body) && Array.isArray(body.items) && isObject(body.calls);

const isApiFailure = (body: unknown): body is ApiFailure =>
  isObject(body) &&
  isObject(body.error) &&
  typeof body.error.code === "string" &&
  typeof body.error.message === "string";

type Options = {
  /** Shrinks a photo before it is sent. Replaced in tests. */
  prepare?: (file: File) => Promise<File>;
  /** Sends the request. Replaced in tests. */
  send?: (url: string, init: RequestInit) => Promise<Response>;
};

/**
 * Sends the photos of one room to /api/detect, as one request, and returns either the detected
 * furniture or a failure with a message that can be shown as it is. Never throws.
 */
export async function requestDetection(
  files: File[],
  { prepare = preparePhoto, send = (url, init) => fetch(url, init) }: Options = {},
): Promise<DetectOutcome> {
  const fail = (failure: DetectFailure): DetectOutcome => ({ ok: false, failure });

  const prepared = await Promise.allSettled(files.map((file) => prepare(file)));
  const unreadable = files.find((_, i) => prepared[i].status === "rejected");
  if (unreadable) {
    return fail({
      code: "unreadable_photo",
      message: `"${unreadable.name}" could not be read as a photo. Remove it and try again.`,
      retryable: false,
    });
  }

  const form = new FormData();
  for (const result of prepared) {
    if (result.status === "fulfilled") form.append("photo", result.value);
  }

  let response: Response;
  try {
    response = await send("/api/detect", {
      method: "POST",
      body: form,
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

  if (response.ok && isDetectResponse(body)) return { ok: true, data: body };

  if (isApiFailure(body)) {
    return fail({
      code: body.error.code,
      message: body.error.message,
      retryable: RETRYABLE.includes(body.error.code),
      calls: body.calls,
    });
  }

  return fail({
    code: "ai_unavailable",
    message: "Something went wrong on our side. Please try again.",
    retryable: true,
  });
}
