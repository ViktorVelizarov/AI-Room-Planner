import "server-only";
import {
  DetectionError,
  MissingApiKeyError,
  detectFurniture,
  generateWithGemini,
  type GenerateFn,
} from "../ai";
import type { ApiErrorCode, ApiFailure, DetectResponse } from "../shared/api";
import { MAX_TOTAL_PHOTO_BYTES, checkPhotoSet } from "../shared/photo";
import {
  CallLimitError,
  callsCookie,
  getCallLimit,
  limitCalls,
  readCalls,
} from "./call-limit";

// Room for the multipart envelope around photos that add up to exactly the size limit.
const FORM_OVERHEAD_BYTES = 1024 * 1024;

const limitMessage = (limit: number) =>
  `You have used all ${limit} AI calls for this session.`;

type Options = {
  /** The model call. Replaced in tests so they need no network. */
  generate?: GenerateFn;
  getLimit?: () => number;
};

/**
 * Builds the POST handler for /api/detect: the photos of one room in, the detected furniture out. Every
 * model call is counted against the session's limit, and a request that is over the limit
 * is answered before anything is sent to the AI provider. Error messages are written for
 * the user; details (provider errors, keys) stay in the server log.
 */
export function createDetectHandler({
  generate = generateWithGemini,
  getLimit = getCallLimit,
}: Options = {}) {
  return async function POST(request: Request): Promise<Response> {
    const calls = readCalls(request, getLimit());
    const callsAtStart = calls.used;

    const respond = (body: DetectResponse | ApiFailure, status: number) => {
      const headers = new Headers({ "Cache-Control": "no-store" });
      // Only when calls were made: otherwise the browser already has the right value.
      if (calls.used !== callsAtStart) {
        headers.append("Set-Cookie", callsCookie(calls));
      }
      return Response.json(body, { status, headers });
    };
    const fail = (code: ApiErrorCode, message: string, status: number) =>
      respond({ error: { code, message }, calls: { ...calls } }, status);

    // Cheapest check first: no need to read an upload for a session that is used up.
    if (calls.used >= calls.limit) {
      return fail("limit_reached", limitMessage(calls.limit), 429);
    }

    const declaredBytes = Number(request.headers.get("content-length"));
    if (declaredBytes > MAX_TOTAL_PHOTO_BYTES + FORM_OVERHEAD_BYTES) {
      return fail("photo_too_large", "The photos are too large.", 413);
    }

    let entries: FormDataEntryValue[];
    try {
      entries = (await request.formData()).getAll("photo");
    } catch {
      entries = [];
    }
    const photos = entries.filter((entry) => typeof entry !== "string");
    if (photos.length < entries.length) {
      return fail("invalid_photo", "Send the photos as files.", 400);
    }

    const check = checkPhotoSet(photos);
    if (!check.ok) {
      return fail(check.code, check.message, check.code === "photo_too_large" ? 413 : 400);
    }

    const images = await Promise.all(
      photos.map(async (photo, i) => ({
        data: Buffer.from(await photo.arrayBuffer()).toString("base64"),
        mimeType: check.types[i],
      })),
    );

    try {
      const result = await detectFurniture(images, limitCalls(generate, calls));
      return respond(
        { items: result.items, unsupported: result.unsupported, calls: { ...calls } },
        200,
      );
    } catch (error) {
      if (error instanceof CallLimitError) {
        return fail("limit_reached", limitMessage(calls.limit), 429);
      }
      if (error instanceof DetectionError) {
        console.error("[detect] invalid answers from the model:", error.reasons);
        return fail(
          "invalid_answer",
          "The AI could not read this photo reliably. Please try again.",
          502,
        );
      }
      if (error instanceof MissingApiKeyError) {
        console.error("[detect]", error.message);
        return fail(
          "server_misconfigured",
          "The server is not set up for AI requests yet.",
          500,
        );
      }
      console.error("[detect] the model call failed:", error);
      return fail(
        "ai_unavailable",
        "The AI service is not available right now. Please try again in a moment.",
        503,
      );
    }
  };
}
