import { afterEach, describe, expect, it, vi } from "vitest";
import { DetectionError, detectFurniture, parseDetection } from "./detect";
import { MissingApiKeyError, generateWithGemini } from "./gemini";
import type { DetectionImage, GenerateFn, ModelAnswer } from "./types";

const image: DetectionImage = { data: "AAAA", mimeType: "image/jpeg" };

const sofa = {
  label: "sofa",
  width_cm: 200,
  depth_cm: 90,
  height_cm: 85,
  color: "dark grey",
  material: "fabric",
};

const answerWith = (value: unknown): ModelAnswer => ({
  text: JSON.stringify(value),
  usage: { inputTokens: 100, outputTokens: 20 },
});

describe("parseDetection", () => {
  it("accepts a valid answer", () => {
    expect(parseDetection(JSON.stringify({ items: [sofa] }))).toEqual({
      ok: true,
      items: [sofa],
      unsupported: 0,
    });
  });

  it("accepts a room with no furniture", () => {
    expect(parseDetection('{"items":[]}')).toMatchObject({ ok: true, items: [] });
  });

  it("ignores unknown fields", () => {
    const result = parseDetection(
      JSON.stringify({ items: [{ ...sofa, confidence: 0.9 }] }),
    );
    expect(result).toEqual({ ok: true, items: [sofa], unsupported: 0 });
  });

  it("drops items labelled 'other' and counts them", () => {
    const tv = { ...sofa, label: "other" };
    const result = parseDetection(JSON.stringify({ items: [tv, sofa, tv] }));
    expect(result).toEqual({ ok: true, items: [sofa], unsupported: 2 });
  });

  it.each([
    ["no text at all", undefined, /empty answer/],
    ["blank text", "  ", /empty answer/],
    ["text that is not JSON", "Here are the items: sofa", /not valid JSON/],
    ["JSON cut off halfway", '{"items":[{"label":"sofa"', /not valid JSON/],
    ["no items field", "{}", /items/],
    ["items that is not a list", '{"items":"sofa"}', /items/],
  ])("rejects %s", (_name, text, reason) => {
    const result = parseDetection(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it.each([
    ["a missing field", { ...sofa, material: undefined }, /material/],
    ["a label that is not supported", { ...sofa, label: "wardrobe" }, /label/],
    ["a material that is not in the list", { ...sofa, material: "marble" }, /material/],
    ["a zero size", { ...sofa, width_cm: 0 }, /width_cm/],
    ["a negative size", { ...sofa, depth_cm: -5 }, /depth_cm/],
    ["an absurdly large size", { ...sofa, height_cm: 5000 }, /height_cm/],
    ["a size that is not a number", { ...sofa, width_cm: "wide" }, /width_cm/],
    ["an empty colour", { ...sofa, color: "  " }, /color/],
  ])("rejects an item with %s", (_name, item, reason) => {
    const result = parseDetection(JSON.stringify({ items: [item] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it("includes why the model stopped in the reason", () => {
    const result = parseDetection(undefined, "SAFETY");
    expect(result).toEqual({ ok: false, reason: "empty answer (SAFETY)" });
  });
});

describe("detectFurniture", () => {
  it("calls the model once when the first answer is valid", async () => {
    const generate = vi.fn<GenerateFn>().mockResolvedValue(answerWith({ items: [sofa] }));

    const result = await detectFurniture([image], generate);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith([image]);
    expect(result).toEqual({
      items: [sofa],
      unsupported: 0,
      attempts: 1,
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  });

  it("sends all the photos of a room together in one call", async () => {
    const generate = vi.fn<GenerateFn>().mockResolvedValue(answerWith({ items: [sofa] }));
    const second: DetectionImage = { data: "BBBB", mimeType: "image/png" };

    const result = await detectFurniture([image, second], generate);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith([image, second]);
    expect(result.attempts).toBe(1);
  });

  it("needs at least one photo", async () => {
    const generate = vi.fn<GenerateFn>();

    await expect(detectFurniture([], generate)).rejects.toThrow(RangeError);
    expect(generate).not.toHaveBeenCalled();
  });

  it("retries once when the first answer is invalid and uses the second", async () => {
    const generate = vi
      .fn<GenerateFn>()
      .mockResolvedValueOnce({ text: '{"items":[{"label":"sofa"' })
      .mockResolvedValueOnce(answerWith({ items: [sofa] }));

    const result = await detectFurniture([image], generate);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual([sofa]);
    expect(result.attempts).toBe(2);
  });

  it("adds up the tokens of both attempts", async () => {
    const generate = vi
      .fn<GenerateFn>()
      .mockResolvedValueOnce({ text: "nope", usage: { inputTokens: 50, outputTokens: 5 } })
      .mockResolvedValueOnce(answerWith({ items: [] }));

    const result = await detectFurniture([image], generate);

    expect(result.usage).toEqual({ inputTokens: 150, outputTokens: 25 });
  });

  it("throws, without using any data, when the retry is also invalid", async () => {
    const generate = vi
      .fn<GenerateFn>()
      .mockResolvedValueOnce(answerWith({ items: [{ ...sofa, width_cm: 0 }] }))
      .mockResolvedValueOnce({ text: "I cannot help with that" });

    const error = await detectFurniture([image], generate).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DetectionError);
    const detection = error as DetectionError;
    expect(detection.attempts).toBe(2);
    expect(detection.reasons).toHaveLength(2);
    expect(detection.reasons[0]).toMatch(/width_cm/);
    expect(detection.reasons[1]).toMatch(/not valid JSON/);
    expect(generate).toHaveBeenCalledTimes(2); // never a third call
  });

  it("does not retry when the call itself fails", async () => {
    const generate = vi.fn<GenerateFn>().mockRejectedValue(new Error("fetch failed"));

    await expect(detectFurniture([image], generate)).rejects.toThrow("fetch failed");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("generateWithGemini", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports a missing API key before sending anything", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(generateWithGemini([image])).rejects.toBeInstanceOf(MissingApiKeyError);
  });
});
