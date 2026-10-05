import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingApiKeyError } from "../ai";
import type { GenerateFn, ModelAnswer } from "../ai";
import type { ApiFailure, DetectResponse } from "../shared/api";
import { MAX_PHOTO_BYTES } from "../shared/photo";
import { createDetectHandler } from "./detect-handler";

const sofa = {
  label: "sofa",
  width_cm: 200,
  depth_cm: 90,
  height_cm: 85,
  color: "dark grey",
  material: "fabric",
} as const;

const goodAnswer: ModelAnswer = { text: JSON.stringify({ items: [sofa] }) };
const badAnswer: ModelAnswer = { text: "not json" };

const photoBytes = new Uint8Array([1, 2, 3, 4, 5]);
const jpeg = (bytes: Uint8Array<ArrayBuffer> = photoBytes) =>
  new File([bytes], "room.jpg", { type: "image/jpeg" });

function requestWith(photo?: File | string, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (photo !== undefined) form.set("photo", photo);
  return new Request("http://localhost/api/detect", { method: "POST", body: form, headers });
}

const failure = async (res: Response) => (await res.json()) as ApiFailure;

describe("POST /api/detect", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // expected failures are logged
  });
  afterEach(() => vi.restoreAllMocks());

  const setup = (...answers: ModelAnswer[]) => {
    const generate = vi.fn<GenerateFn>();
    for (const answer of answers) generate.mockResolvedValueOnce(answer);
    return { generate, POST: createDetectHandler({ generate, getLimit: () => 10 }) };
  };

  describe("a valid photo", () => {
    it("returns the furniture and counts one call", async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(requestWith(jpeg()));

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        items: [sofa],
        unsupported: 0,
        calls: { used: 1, limit: 10 },
      } satisfies DetectResponse);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=1;");
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledWith({
        data: Buffer.from(photoBytes).toString("base64"),
        mimeType: "image/jpeg",
      });
    });

    it("adds to the count the browser already has", async () => {
      const { POST } = setup(goodAnswer);

      const res = await POST(requestWith(jpeg(), { cookie: "ai_calls=4" }));

      expect((await res.json()).calls).toEqual({ used: 5, limit: 10 });
      expect(res.headers.get("set-cookie")).toContain("ai_calls=5;");
    });

    it("counts the retry as a second call", async () => {
      const { generate, POST } = setup(badAnswer, goodAnswer);

      const res = await POST(requestWith(jpeg()));

      expect(res.status).toBe(200);
      expect(generate).toHaveBeenCalledTimes(2);
      expect((await res.json()).calls.used).toBe(2);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=2;");
    });

    it("leaves out items of an unsupported type", async () => {
      const tv = { ...sofa, label: "other" };
      const { POST } = setup({ text: JSON.stringify({ items: [tv, sofa] }) });

      const body = (await (await POST(requestWith(jpeg()))).json()) as DetectResponse;

      expect(body.items).toEqual([sofa]);
      expect(body.unsupported).toBe(1);
    });
  });

  describe("the call limit", () => {
    it("blocks a session that has used up its calls, without calling the model", async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(requestWith(jpeg(), { cookie: "ai_calls=10" }));

      expect(res.status).toBe(429);
      expect(await failure(res)).toEqual({
        error: {
          code: "limit_reached",
          message: "You have used all 10 AI calls for this session.",
        },
        calls: { used: 10, limit: 10 },
      });
      expect(generate).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull(); // nothing changed
    });

    it("blocks without even reading the upload", async () => {
      const { generate, POST } = setup(goodAnswer);

      // No photo at all: a session that is used up is told so, not "send a photo".
      const res = await POST(requestWith(undefined, { cookie: "ai_calls=10" }));

      expect(res.status).toBe(429);
      expect(generate).not.toHaveBeenCalled();
    });

    it("stops the retry when the first call used the last one allowed", async () => {
      const { generate, POST } = setup(badAnswer, goodAnswer);

      const res = await POST(requestWith(jpeg(), { cookie: "ai_calls=9" }));

      expect(res.status).toBe(429);
      expect((await failure(res)).error.code).toBe("limit_reached");
      expect(generate).toHaveBeenCalledTimes(1); // the second answer was never requested
      expect(res.headers.get("set-cookie")).toContain("ai_calls=10;");
    });

    it("uses the limit it is given", async () => {
      const generate = vi.fn<GenerateFn>().mockResolvedValue(goodAnswer);
      const POST = createDetectHandler({ generate, getLimit: () => 2 });

      const res = await POST(requestWith(jpeg(), { cookie: "ai_calls=2" }));

      expect(res.status).toBe(429);
      expect((await failure(res)).calls).toEqual({ used: 2, limit: 2 });
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe("a request that is not a usable photo", () => {
    it.each([
      ["no photo field", () => requestWith(undefined)],
      ["a text value instead of a file", () => requestWith("sofa")],
      [
        "a body that is not form data",
        () =>
          new Request("http://localhost/api/detect", {
            method: "POST",
            body: JSON.stringify({ photo: "x" }),
            headers: { "content-type": "application/json" },
          }),
      ],
    ])("rejects %s", async (_name, makeRequest) => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(makeRequest());

      expect(res.status).toBe(400);
      expect((await failure(res)).error.code).toBe("invalid_photo");
      expect(generate).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull(); // no call, no count
    });

    it("rejects a file type that is not supported", async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(requestWith(new File([photoBytes], "a.gif", { type: "image/gif" })));

      expect(res.status).toBe(400);
      expect((await failure(res)).error).toEqual({
        code: "invalid_photo",
        message: "Only JPG, PNG and WebP photos are supported.",
      });
      expect(generate).not.toHaveBeenCalled();
    });

    it("rejects a photo over the size limit", async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(requestWith(jpeg(new Uint8Array(MAX_PHOTO_BYTES + 1))));

      expect(res.status).toBe(413);
      expect((await failure(res)).error.code).toBe("photo_too_large");
      expect(generate).not.toHaveBeenCalled();
    });

    it("rejects an upload that announces a huge size before reading it", async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(
        requestWith(jpeg(), { "content-length": String(MAX_PHOTO_BYTES * 3) }),
      );

      expect(res.status).toBe(413);
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe("when the AI side fails", () => {
    it("reports an unreadable photo after two invalid answers, and counts both calls", async () => {
      const { generate, POST } = setup(badAnswer, badAnswer);

      const res = await POST(requestWith(jpeg()));

      expect(res.status).toBe(502);
      expect(await failure(res)).toEqual({
        error: {
          code: "invalid_answer",
          message: "The AI could not read this photo reliably. Please try again.",
        },
        calls: { used: 2, limit: 10 },
      });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=2;");
    });

    it("hides the provider's error text from the user, but still counts the call", async () => {
      const generate = vi
        .fn<GenerateFn>()
        .mockRejectedValue(new Error("403 key=SECRET-KEY-123 is not allowed"));
      const POST = createDetectHandler({ generate, getLimit: () => 10 });

      const res = await POST(requestWith(jpeg()));
      const text = await res.text();

      expect(res.status).toBe(503);
      expect(text).toContain("ai_unavailable");
      expect(text).not.toContain("SECRET-KEY-123");
      expect(res.headers.get("set-cookie")).toContain("ai_calls=1;");
      expect(generate).toHaveBeenCalledTimes(1); // call errors are not retried
    });

    it("says only that the server is not set up when the API key is missing", async () => {
      const generate = vi.fn<GenerateFn>().mockRejectedValue(new MissingApiKeyError());
      const POST = createDetectHandler({ generate, getLimit: () => 10 });

      const res = await POST(requestWith(jpeg()));
      const text = await res.text();

      expect(res.status).toBe(500);
      expect(text).toContain("server_misconfigured");
      expect(text).not.toContain("GEMINI_API_KEY");
    });
  });
});
