import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingApiKeyError } from "../ai";
import type { GenerateLayoutFn, ModelAnswer } from "../ai";
import type { ApiFailure, LayoutResponse } from "../shared/api";
import { typicalItem, type FurnitureItem } from "../shared/furniture";
import { MAX_LAYOUT_PIECES, type Pose } from "../shared/layout";
import { createLayoutHandler } from "./layout-handler";

const sofa: FurnitureItem = { ...typicalItem("sofa"), width_cm: 200, depth_cm: 90 };
const table: FurnitureItem = { ...typicalItem("coffee_table"), width_cm: 100, depth_cm: 60 };
const room = { width_m: 5, length_m: 4, height_m: 2.5 };
const description = { room, furniture: [sofa, table] };

const fine: Pose[] = [
  { x_m: 0, z_m: 1.45, rotation_deg: 180 },
  { x_m: 0, z_m: 0.35, rotation_deg: 0 },
];
const labels = description.furniture.map((item) => item.label);
const answerFor = (poses: Pose[]): ModelAnswer => ({
  text: JSON.stringify({ pieces: poses.map((pose, index) => ({ index, label: labels[index], ...pose })) }),
});
const goodAnswer = answerFor(fine);
const badAnswer: ModelAnswer = { text: "not json" };

function requestWith(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/layout", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

const failure = async (res: Response) => (await res.json()) as ApiFailure;

describe("POST /api/layout", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // expected failures are logged
  });
  afterEach(() => vi.restoreAllMocks());

  const setup = (...answers: ModelAnswer[]) => {
    const generate = vi.fn<GenerateLayoutFn>();
    for (const answer of answers) generate.mockResolvedValueOnce(answer);
    return { generate, POST: createLayoutHandler({ generate, getLimit: () => 10 }) };
  };

  describe("a valid room description (AC1)", () => {
    it("returns a place and a turn for every piece and counts one call", async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(requestWith(description));

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ layout: fine, adjusted: [], calls: { used: 1, limit: 10 } } satisfies LayoutResponse);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=1;");
      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledWith({ description, feedback: undefined });
    });

    it("sends the model a clean copy of the description, without anything that was not asked for", async () => {
      const { generate, POST } = setup(goodAnswer);

      await POST(requestWith({ ...description, secret: "x", furniture: [{ ...sofa, extra: 1 }, table] }));

      expect(generate.mock.calls[0][0].description).toEqual(description);
    });

    it("adds to the count the browser already has", async () => {
      const { POST } = setup(goodAnswer);

      const res = await POST(requestWith(description, { cookie: "ai_calls=4" }));

      expect((await res.json()).calls).toEqual({ used: 5, limit: 10 });
      expect(res.headers.get("set-cookie")).toContain("ai_calls=5;");
    });

    it("says which pieces the app moved to stop them overlapping, and returns a layout that is fine", async () => {
      const overlapping: Pose[] = [{ x_m: 0, z_m: 1.45, rotation_deg: 180 }, { x_m: 0, z_m: 0.9, rotation_deg: 0 }];
      const { POST } = setup(answerFor(overlapping));

      const body = (await (await POST(requestWith(description))).json()) as LayoutResponse;

      expect(body.adjusted).toEqual([0, 1]);
      expect(body.layout).toHaveLength(2);
      expect(body.layout).not.toEqual(overlapping);
    });
  });

  describe("an answer that is not a layout (AC3)", () => {
    it("counts the retry as a second call, and tells the model what was wrong", async () => {
      const { generate, POST } = setup(badAnswer, goodAnswer);

      const res = await POST(requestWith(description));

      expect(res.status).toBe(200);
      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate.mock.calls[1][0].feedback).toMatch(/not valid JSON/);
      expect((await res.json()).calls.used).toBe(2);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=2;");
    });

    it("says that the AI could not make a usable layout after two answers that are not, and counts both calls", async () => {
      const { generate, POST } = setup(badAnswer, badAnswer);

      const res = await POST(requestWith(description));

      expect(res.status).toBe(502);
      expect(await failure(res)).toEqual({
        error: { code: "invalid_answer", message: "The AI could not make a usable layout this time. Please try again." },
        calls: { used: 2, limit: 10 },
      });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=2;");
    });

    it("says that furniture still overlapped when the app could not fix the layout, and counts the call", async () => {
      // Two long thin pieces, each across the whole of a room of 1 m x 1 m in a different way: they cross wherever they are put.
      const across = { ...typicalItem("bookshelf"), width_cm: 100, depth_cm: 10 };
      const along = { ...typicalItem("bookshelf"), width_cm: 10, depth_cm: 100 };
      const crossing = { room: { ...room, width_m: 1, length_m: 1 }, furniture: [across, along] };
      const poses: Pose[] = [{ x_m: 0, z_m: 0, rotation_deg: 0 }, { x_m: 0, z_m: 0, rotation_deg: 0 }];
      const { generate, POST } = setup({
        text: JSON.stringify({ pieces: poses.map((pose, index) => ({ index, label: "bookshelf", ...pose })) }),
      });

      const res = await POST(requestWith(crossing));

      expect(res.status).toBe(502);
      expect(await failure(res)).toEqual({
        error: {
          code: "layout_has_overlaps",
          message: "The layout that the AI made still had furniture overlapping after the app tried to fix it. Please try again, or check the size of the room and of the furniture.",
        },
        calls: { used: 1, limit: 10 },
      });
      expect(generate).toHaveBeenCalledTimes(1); // a layout that is not fine is not asked for again
      expect(res.headers.get("set-cookie")).toContain("ai_calls=1;");
      expect(console.error).toHaveBeenCalledWith("[layout] pieces still overlap after fixing:", expect.arrayContaining([expect.stringContaining("Bookshelf (item")]));
    });
  });

  describe("the call limit (AC4)", () => {
    it("blocks a session that has used up its calls, without calling the model", async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(requestWith(description, { cookie: "ai_calls=10" }));

      expect(res.status).toBe(429);
      expect(await failure(res)).toEqual({
        error: { code: "limit_reached", message: "You have used all 10 AI calls for this session." },
        calls: { used: 10, limit: 10 },
      });
      expect(generate).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull(); // nothing changed
    });

    it("blocks without even reading the request", async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(requestWith("this is not a room description", { cookie: "ai_calls=10" }));

      expect(res.status).toBe(429);
      expect(generate).not.toHaveBeenCalled();
    });

    it("stops the retry when the first call used the last one allowed", async () => {
      const { generate, POST } = setup(badAnswer, goodAnswer);

      const res = await POST(requestWith(description, { cookie: "ai_calls=9" }));

      expect(res.status).toBe(429);
      expect((await failure(res)).error.code).toBe("limit_reached");
      expect(generate).toHaveBeenCalledTimes(1); // the second answer was never requested
      expect(res.headers.get("set-cookie")).toContain("ai_calls=10;");
    });

    it("uses the limit it is given", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockResolvedValue(goodAnswer);
      const POST = createLayoutHandler({ generate, getLimit: () => 2 });

      const res = await POST(requestWith(description, { cookie: "ai_calls=2" }));

      expect(res.status).toBe(429);
      expect((await failure(res)).calls).toEqual({ used: 2, limit: 2 });
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe("a request that is not a room description", () => {
    it.each([
      ["text that is not JSON", () => requestWith("sofa, table")],
      ["an empty body", () => requestWith("")],
      ["a list instead of an object", () => requestWith([])],
      ["no room", () => requestWith({ furniture: [sofa] })],
      ["no furniture", () => requestWith({ room, furniture: [] })],
      ["a piece without a size", () => requestWith({ room, furniture: [{ ...sofa, width_cm: undefined }] })],
      ["a room that is too small", () => requestWith({ room: { ...room, width_m: 0.2 }, furniture: [sofa] })],
    ])("rejects %s, without calling the model or counting a call", async (_name, makeRequest) => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(makeRequest());

      expect(res.status).toBe(400);
      expect((await failure(res)).error.code).toBe("invalid_description");
      expect((await failure(await POST(makeRequest()))).error.message).toMatch(/^The room description is not valid\./);
      expect(generate).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    it("says what is wrong, in sentences, and which piece", async () => {
      const { POST } = setup(goodAnswer);

      const res = await POST(requestWith({ room, furniture: [sofa, { ...table, depth_cm: 0 }] }));

      expect((await failure(res)).error.message).toContain("Furniture item 2 (Coffee table)");
    });

    it(`rejects more than ${MAX_LAYOUT_PIECES} pieces`, async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(requestWith({ room, furniture: Array.from({ length: MAX_LAYOUT_PIECES + 1 }, () => table) }));

      expect(res.status).toBe(400);
      expect((await failure(res)).error.message).toContain(`at most ${MAX_LAYOUT_PIECES} pieces`);
      expect(generate).not.toHaveBeenCalled();
    });

    it("rejects a request that announces a huge size before reading it", async () => {
      const { generate, POST } = setup(goodAnswer);

      const res = await POST(requestWith(description, { "content-length": String(10 * 1024 * 1024) }));

      expect(res.status).toBe(413);
      expect((await failure(res)).error).toEqual({ code: "invalid_description", message: "The room description is too large." });
      expect(generate).not.toHaveBeenCalled();
    });

    it("rejects a body that is huge although it did not say so", async () => {
      const { generate, POST } = setup(goodAnswer);
      const huge = JSON.stringify({ ...description, notes: "x".repeat(70 * 1024) });

      const res = await POST(new Request("http://localhost/api/layout", { method: "POST", body: huge }));

      expect(res.status).toBe(413);
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe("a room that cannot hold its furniture", () => {
    it("is refused before the model is asked, with a message that says why, and no call is counted", async () => {
      const { generate, POST } = setup(goodAnswer);
      const full = { room: { ...room, width_m: 4, length_m: 3 }, furniture: Array.from({ length: 6 }, () => sofa) };

      const res = await POST(requestWith(full));

      expect(res.status).toBe(422);
      const { error, calls } = await failure(res);
      expect(error.code).toBe("room_too_full");
      expect(error.message).toBe("Your furniture would cover 90% of the floor, which leaves no room for a layout without overlaps. Check the size of the room, or take some furniture out of the list.");
      expect(calls).toEqual({ used: 0, limit: 10 });
      expect(generate).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  });

  describe("when the AI side fails", () => {
    it("hides the provider's error text from the user, but still counts the call", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockRejectedValue(new Error("403 key=SECRET-KEY-123 is not allowed"));
      const POST = createLayoutHandler({ generate, getLimit: () => 10 });

      const res = await POST(requestWith(description));
      const text = await res.text();

      expect(res.status).toBe(503);
      expect(text).toContain("ai_unavailable");
      expect(text).not.toContain("SECRET-KEY-123");
      expect(res.headers.get("set-cookie")).toContain("ai_calls=1;");
      expect(generate).toHaveBeenCalledTimes(1); // call errors are not retried
    });

    it("says only that the server is not set up when the API key is missing", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockRejectedValue(new MissingApiKeyError());
      const POST = createLayoutHandler({ generate, getLimit: () => 10 });

      const res = await POST(requestWith(description));
      const text = await res.text();

      expect(res.status).toBe(500);
      expect(text).toContain("server_misconfigured");
      expect(text).not.toContain("GEMINI_API_KEY");
    });

    it("writes the error of the provider in the log, and not in the answer to the browser", async () => {
      const failure = new Error("403 key=SECRET-KEY-123 is not allowed");
      const generate = vi.fn<GenerateLayoutFn>().mockRejectedValue(failure);
      const POST = createLayoutHandler({ generate, getLimit: () => 10 });

      const res = await POST(requestWith(description));

      expect(console.error).toHaveBeenCalledWith("[layout] the model call failed:", failure);
      expect(await res.text()).not.toContain("SECRET-KEY-123");
    });

    it("writes that the API key is missing in the log", async () => {
      const generate = vi.fn<GenerateLayoutFn>().mockRejectedValue(new MissingApiKeyError());
      const POST = createLayoutHandler({ generate, getLimit: () => 10 });

      await POST(requestWith(description));

      expect(console.error).toHaveBeenCalledWith("[layout]", expect.stringContaining("GEMINI_API_KEY"));
    });

    it("writes what was wrong with the answers in the log, and not in the answer to the browser", async () => {
      const { POST } = setup(badAnswer, badAnswer);

      const res = await POST(requestWith(description));

      expect(console.error).toHaveBeenCalledWith("[layout] invalid answers from the model:", expect.arrayContaining([expect.stringContaining("not valid JSON")]));
      expect(await res.text()).not.toContain("not valid JSON");
    });
  });
});
