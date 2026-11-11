import { ApiError, FinishReason, GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { buildLayoutPrompt } from "./layout-prompt";
import { layoutJsonSchema } from "./layout-schema";
import { buildDetectionPrompt } from "./prompt";
import { detectionJsonSchema } from "./schema";
import type { DetectionImage, GenerateFn, GenerateLayoutFn, LayoutRequest, ModelAnswer } from "./types";

const DEFAULT_MODEL = "gemini-3.1-pro-preview";
// The slowest of the 120 benchmark calls took 30 s.
const REQUEST_TIMEOUT_MS = 60_000;

// A layout is a longer piece of thinking than a list of what is in a photo: on the first real runs (US-21) two
// of three layout calls did not finish in 60 s, and Gemini answered 504 DEADLINE_EXCEEDED, since the SDK sends
// the timeout to the server as its deadline. So layouts have their own, longer, deadline.
export const DEFAULT_LAYOUT_TIMEOUT_S = 120;
/** The shortest and the longest deadline that can be asked for. The longest makes four calls one after the other, which is what a request may need, fit in 10 minutes. */
export const MIN_LAYOUT_TIMEOUT_S = 10;
export const MAX_LAYOUT_TIMEOUT_S = 150;

/**
 * The deadline of one layout call, in milliseconds: GEMINI_LAYOUT_TIMEOUT_S if it is a whole number of
 * seconds from 10 to 150, else 120 s. Nothing, or white space, is no number in that range (0 and NaN).
 */
export function getLayoutTimeoutMs(value = process.env.GEMINI_LAYOUT_TIMEOUT_S): number {
  const seconds = Number(value);
  const valid = Number.isInteger(seconds) && seconds >= MIN_LAYOUT_TIMEOUT_S && seconds <= MAX_LAYOUT_TIMEOUT_S;
  return (valid ? seconds : DEFAULT_LAYOUT_TIMEOUT_S) * 1000;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key.",
    );
    this.name = "MissingApiKeyError";
  }
}

/** The model did not answer in time. It is told apart from a service that is down, because trying again, or a longer deadline, can help. */
export class AiTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options?: ErrorOptions) {
    super(`The model did not answer within ${timeoutMs / 1000} s.`, options);
    this.name = "AiTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Whether a failed call was one that ran out of time: Gemini's own 504 (or 408), or the request being cut off here. */
export function isDeadlineExceeded(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 504 || error.status === 408;
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** The Gemini client. The SDK is left without its own HTTP retries, so one call is exactly one paid request. */
function createClient(timeoutMs = REQUEST_TIMEOUT_MS): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();

  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: timeoutMs },
  });
}

/** What Gemini answered, as both calls here return it: the text, why it may be unusable, and the tokens used. */
function toModelAnswer(response: GenerateContentResponse): ModelAnswer {
  const finishReason = response.candidates?.[0]?.finishReason;
  const note =
    response.promptFeedback?.blockReason ??
    (finishReason && finishReason !== FinishReason.STOP
      ? finishReason
      : undefined);
  const usage = response.usageMetadata;

  return {
    text: response.text,
    note,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens:
        (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    },
  };
}

/** What goes into the request: every photo, then the instructions. */
export function requestParts(images: DetectionImage[]) {
  return [
    ...images.map((image) => ({
      inlineData: { data: image.data, mimeType: image.mimeType },
    })),
    { text: buildDetectionPrompt(images.length) },
  ];
}

/**
 * Sends the photos of one room to Gemini and returns its raw answer. The SDK is left without its own
 * HTTP retries, so one call here is exactly one paid request.
 */
export const generateWithGemini: GenerateFn = async (images) => {
  const ai = createClient();
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    contents: [{ role: "user", parts: requestParts(images) }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: detectionJsonSchema(),
    },
  });
  return toModelAnswer(response);
};

/** What goes into a layout request: the instructions, with the room and the furniture in them, and the style. There are no photos. */
export function layoutRequestParts(request: LayoutRequest) {
  const { style, alongside, avoid } = request;
  return [{ text: buildLayoutPrompt(request.description, request.feedback, { style, alongside, avoid }) }];
}

/**
 * Asks Gemini for a layout of the furniture of a room and returns its raw answer. Like the detection
 * call, it is exactly one paid request. It has the longer deadline of layouts, and a call that runs
 * out of time throws an AiTimeoutError. A layout asked for in a style must come with a description,
 * so the schema says so; an answer is still accepted without one (see `parseLayoutAnswer`).
 */
export const generateLayoutWithGemini: GenerateLayoutFn = async (request) => {
  const timeoutMs = getLayoutTimeoutMs();
  const ai = createClient(timeoutMs);
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: [{ role: "user", parts: layoutRequestParts(request) }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: layoutJsonSchema({ withDescription: request.style !== undefined }),
      },
    });
    return toModelAnswer(response);
  } catch (error) {
    throw isDeadlineExceeded(error) ? new AiTimeoutError(timeoutMs, { cause: error }) : error;
  }
};
