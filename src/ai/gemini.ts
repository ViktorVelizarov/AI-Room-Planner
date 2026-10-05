import { FinishReason, GoogleGenAI } from "@google/genai";
import { buildDetectionPrompt } from "./prompt";
import { detectionJsonSchema } from "./schema";
import type { DetectionImage, GenerateFn } from "./types";

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS },
  });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    contents: [{ role: "user", parts: requestParts(images) }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: detectionJsonSchema(),
    },
  });

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
};
