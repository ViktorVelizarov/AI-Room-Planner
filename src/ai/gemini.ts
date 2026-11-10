import { FinishReason, GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { buildLayoutPrompt } from "./layout-prompt";
import { layoutJsonSchema } from "./layout-schema";
import { buildDetectionPrompt } from "./prompt";
import { detectionJsonSchema } from "./schema";
import type { DetectionImage, GenerateFn, GenerateLayoutFn, LayoutRequest, ModelAnswer } from "./types";

const DEFAULT_MODEL = "gemini-3.1-pro-preview";
// The slowest of the 120 benchmark calls took 30 s.
const REQUEST_TIMEOUT_MS = 60_000;

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key.",
    );
    this.name = "MissingApiKeyError";
  }
}

/** The Gemini client. The SDK is left without its own HTTP retries, so one call is exactly one paid request. */
function createClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();

  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS },
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

/** What goes into a layout request: the instructions, with the room and the furniture in them. There are no photos. */
export function layoutRequestParts(request: LayoutRequest) {
  return [{ text: buildLayoutPrompt(request.description, request.feedback) }];
}

/**
 * Asks Gemini for a layout of the furniture of a room and returns its raw answer. Like the detection
 * call, it is exactly one paid request.
 */
export const generateLayoutWithGemini: GenerateLayoutFn = async (request) => {
  const ai = createClient();
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    contents: [{ role: "user", parts: layoutRequestParts(request) }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: layoutJsonSchema(),
    },
  });
  return toModelAnswer(response);
};
