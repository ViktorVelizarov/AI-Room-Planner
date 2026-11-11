import { ApiError, GoogleGenAI } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { typicalItem } from "../shared/furniture";
import {
  AiTimeoutError,
  DEFAULT_LAYOUT_TIMEOUT_S,
  MAX_LAYOUT_TIMEOUT_S,
  MIN_LAYOUT_TIMEOUT_S,
  generateLayoutWithGemini,
  getLayoutTimeoutMs,
  isDeadlineExceeded,
} from "./gemini";

// The SDK is replaced by one that records how it is made and asked, and answers or fails as the test says.
vi.mock("@google/genai", async (importOriginal) => ({ ...(await importOriginal<typeof import("@google/genai")>()), GoogleGenAI: vi.fn() }));
const Client = vi.mocked(GoogleGenAI);
const generateContent = vi.fn();

const description = { room: { width_m: 5, length_m: 4, height_m: 2.5 }, furniture: [typicalItem("sofa")] };

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "a-key-for-tests");
  vi.stubEnv("GEMINI_LAYOUT_TIMEOUT_S", "");
  Client.mockImplementation(function () {
    return { models: { generateContent } } as unknown as GoogleGenAI;
  });
  generateContent.mockResolvedValue({ text: "{}", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("getLayoutTimeoutMs: how long one layout call may take", () => {
  it("is 120 seconds when nothing is set, which is longer than the 60 s of a detection, since layouts did not finish in 60 s", () => {
    expect(DEFAULT_LAYOUT_TIMEOUT_S).toBe(120);
    expect(getLayoutTimeoutMs(undefined)).toBe(120_000);
    expect(getLayoutTimeoutMs("")).toBe(120_000);
    expect(getLayoutTimeoutMs("   ")).toBe(120_000);
  });

  it("is what GEMINI_LAYOUT_TIMEOUT_S says, in seconds, from 10 to 150", () => {
    expect(MIN_LAYOUT_TIMEOUT_S).toBe(10);
    expect(MAX_LAYOUT_TIMEOUT_S).toBe(150);
    expect(getLayoutTimeoutMs("10")).toBe(10_000);
    expect(getLayoutTimeoutMs("90")).toBe(90_000);
    expect(getLayoutTimeoutMs("150")).toBe(150_000);
    expect(getLayoutTimeoutMs(" 75 ")).toBe(75_000);
  });

  it.each(["9", "151", "0", "-30", "1.5", "60.5", "99.9", "abc", "60s", "Infinity", "NaN", "1e3"])("is the default for %j, which is not a whole number of seconds from 10 to 150", (value) => {
    expect(getLayoutTimeoutMs(value)).toBe(120_000);
  });

  it("reads the setting from the environment when it is not given one", () => {
    vi.stubEnv("GEMINI_LAYOUT_TIMEOUT_S", "45");

    expect(getLayoutTimeoutMs()).toBe(45_000);
  });
});

describe("isDeadlineExceeded: a call that ran out of time", () => {
  it("is Gemini's own 504 and 408", () => {
    expect(isDeadlineExceeded(new ApiError({ message: '{"error":{"code":504,"status":"DEADLINE_EXCEEDED"}}', status: 504 }))).toBe(true);
    expect(isDeadlineExceeded(new ApiError({ message: "Request timeout", status: 408 }))).toBe(true);
  });

  it("is not another error of Gemini, which is the service being down or the call being wrong", () => {
    for (const status of [400, 401, 403, 429, 500, 502, 503]) {
      expect(isDeadlineExceeded(new ApiError({ message: "no", status })), String(status)).toBe(false);
    }
  });

  it("is a request that was cut off here, by name, and not an error that only says so in its words", () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    expect(isDeadlineExceeded(abort)).toBe(true);
    expect(isDeadlineExceeded(new DOMException("timed out", "TimeoutError"))).toBe(true);
    expect(isDeadlineExceeded(new Error("DEADLINE_EXCEEDED"))).toBe(false);
    expect(isDeadlineExceeded(new TypeError("fetch failed"))).toBe(false);
  });

  it("is not something that is not an error", () => {
    for (const value of [undefined, null, "timeout", 504, { status: 504 }]) expect(isDeadlineExceeded(value), String(value)).toBe(false);
  });
});

describe("generateLayoutWithGemini: the call for a layout", () => {
  it("is made with the deadline of a layout, as the timeout of the client that the SDK sends to Gemini", async () => {
    await generateLayoutWithGemini({ description });

    expect(Client).toHaveBeenCalledTimes(1);
    expect(Client.mock.calls[0][0]).toMatchObject({ apiKey: "a-key-for-tests", httpOptions: { timeout: 120_000 } });
  });

  it("is made with the deadline that is set", async () => {
    vi.stubEnv("GEMINI_LAYOUT_TIMEOUT_S", "100");

    await generateLayoutWithGemini({ description });

    expect(Client.mock.calls[0][0]).toMatchObject({ httpOptions: { timeout: 100_000 } });
  });

  it("gives the answer in the form that the rest of the app reads", async () => {
    const answer = await generateLayoutWithGemini({ description });

    expect(answer).toEqual({ text: "{}", note: undefined, usage: { inputTokens: 1, outputTokens: 2 } });
  });

  it("asks for JSON in the schema of a layout, with the description required for a layout in a style, and optional for one without", async () => {
    await generateLayoutWithGemini({ description, style: "cosy" });
    await generateLayoutWithGemini({ description });

    const schemas = generateContent.mock.calls.map(([request]) => request.config.responseJsonSchema as { required?: string[] });
    expect(generateContent.mock.calls[0][0].config.responseMimeType).toBe("application/json");
    expect([...(schemas[0].required ?? [])].sort()).toEqual(["description", "pieces"]);
    expect(schemas[1].required).toEqual(["pieces"]);
  });

  it("sends the instructions with the style in them", async () => {
    await generateLayoutWithGemini({ description, style: "work" });

    const [[request]] = generateContent.mock.calls;
    expect(request.contents[0].parts[0].text).toContain("THE STYLE OF THIS LAYOUT: WORK-FOCUSED");
  });

  describe("a call that runs out of time", () => {
    it("is an AiTimeoutError, which says how long the deadline was and keeps what Gemini said", async () => {
      const gemini = new ApiError({ message: '{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}', status: 504 });
      generateContent.mockRejectedValue(gemini);

      const error = await generateLayoutWithGemini({ description, style: "cosy" }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AiTimeoutError);
      expect((error as AiTimeoutError).timeoutMs).toBe(120_000);
      expect((error as AiTimeoutError).message).toBe("The model did not answer within 120 s.");
      expect((error as AiTimeoutError).cause).toBe(gemini);
    });

    it("says the deadline that was set", async () => {
      vi.stubEnv("GEMINI_LAYOUT_TIMEOUT_S", "30");
      generateContent.mockRejectedValue(new ApiError({ message: "late", status: 504 }));

      const error = await generateLayoutWithGemini({ description }).catch((caught: unknown) => caught);

      expect((error as AiTimeoutError).timeoutMs).toBe(30_000);
      expect((error as AiTimeoutError).message).toBe("The model did not answer within 30 s.");
    });

    it("is one that was cut off here as well", async () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      generateContent.mockRejectedValue(abort);

      await expect(generateLayoutWithGemini({ description })).rejects.toBeInstanceOf(AiTimeoutError);
    });

    it("is asked once, not again: it is one paid request", async () => {
      generateContent.mockRejectedValue(new ApiError({ message: "late", status: 504 }));

      await generateLayoutWithGemini({ description }).catch(() => {});

      expect(generateContent).toHaveBeenCalledTimes(1);
    });
  });

  it("lets another failure of the call through as it was, so that it is told as the service being down", async () => {
    const down = new ApiError({ message: "overloaded", status: 503 });
    generateContent.mockRejectedValue(down);

    await expect(generateLayoutWithGemini({ description })).rejects.toBe(down);
  });

  it("does not turn a missing key into a timeout, and asks nothing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(generateLayoutWithGemini({ description })).rejects.toThrow("GEMINI_API_KEY");
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("AiTimeoutError", () => {
  it("is an error with a name of its own, which is how it is told from the others in a log", () => {
    const error = new AiTimeoutError(60_000);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AiTimeoutError");
    expect(error.timeoutMs).toBe(60_000);
    expect(error.message).toBe("The model did not answer within 60 s.");
  });
});
