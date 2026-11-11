import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiTimeoutError, MissingApiKeyError } from "../ai";
import type { GenerateLayoutFn, LayoutRequest, ModelAnswer } from "../ai";
import type { ApiFailure, LayoutsResponse, StyleFailure } from "../shared/api";
import { typicalItem, type FurnitureItem } from "../shared/furniture";
import { MAX_LAYOUT_PIECES, type Pose } from "../shared/layout";
import { LAYOUT_STYLES, STYLE_IDEAS, type LayoutStyle } from "../shared/layout-styles";
import { createLayoutHandler } from "./layout-handler";

// Four small tables in a big room, so that layouts of them cannot overlap and what is tested is the handler.
const table: FurnitureItem = { ...typicalItem("side_table"), width_cm: 45, depth_cm: 45 };
const room = { width_m: 8, length_m: 6, height_m: 2.5 };
const description = { room, furniture: [table, table, table, table] };
const XS = [-3, -1, 1, 3];
const along = (...zs: number[]): Pose[] => zs.map((z_m, index) => ({ x_m: XS[index], z_m, rotation_deg: 0 }));
const answerOf = (poses: Pose[], text?: string): ModelAnswer => ({
  text: JSON.stringify({ ...(text === undefined ? {} : { description: text }), pieces: poses.map((pose, index) => ({ index, label: "side_table", ...pose })) }),
});

// Layouts that differ in every piece from each other.
const BACK = along(-1.5, -1.5, -1.5, -1.5);
const MIDDLE = along(0, 0, 0, 0);
const FRONT = along(1.5, 1.5, 1.5, 1.5);
const badAnswer: ModelAnswer = { text: "not json" };

type Script = ModelAnswer | Error;
/** A model that answers what each style is scripted to, in order. It records every request. */
function fakeModel(scripts: Partial<Record<LayoutStyle, Script[]>>) {
  const requests: LayoutRequest[] = [];
  const generate = vi.fn<GenerateLayoutFn>(async (request) => {
    requests.push(request);
    const next = scripts[request.style!]?.shift();
    if (!next) throw new Error(`Unexpected call for ${request.style}`);
    if (next instanceof Error) throw next;
    return next;
  });
  return { generate, requests };
}
const threeFine = () => fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(MIDDLE)], work: [answerOf(FRONT)] });

function requestWith(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/layout", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

const failure = async (res: Response) => (await res.json()) as ApiFailure;
const handlerFor = (model: { generate: GenerateLayoutFn }, limit = 10) => createLayoutHandler({ generate: model.generate, getLimit: () => limit });
const resultsOf = async (res: Response) => ((await res.json()) as LayoutsResponse).results;

describe("POST /api/layout", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // expected failures are logged
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  describe("a valid room description, for all three styles (AC1, AC2)", () => {
    it("returns a layout in each style, with the name of the style and a description, and counts one call for each", async () => {
      const model = fakeModel({
        spacious: [answerOf(BACK, "Open and airy.")],
        cosy: [answerOf(MIDDLE, "Snug and sociable. Everything is close together.")],
        work: [answerOf(FRONT, "The desk has the best place.")],
      });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        results: [
          { style: "spacious", ok: true, name: "Spacious", description: "Open and airy.", poses: BACK, adjusted: [] },
          { style: "cosy", ok: true, name: "Cosy", description: "Snug and sociable. Everything is close together.", poses: MIDDLE, adjusted: [] },
          { style: "work", ok: true, name: "Work-focused", description: "The desk has the best place.", poses: FRONT, adjusted: [] },
        ],
        calls: { used: 3, limit: 10 },
      } satisfies LayoutsResponse);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=3;");
      expect(model.generate).toHaveBeenCalledTimes(3);
    });

    it("gives a layout the idea of its style when the AI wrote no description for it", async () => {
      const res = await handlerFor(threeFine())(requestWith({ description }));

      expect((await resultsOf(res)).map((result) => result.ok && result.description)).toEqual([STYLE_IDEAS.spacious, STYLE_IDEAS.cosy, STYLE_IDEAS.work]);
    });

    it("sends the model a clean copy of the description, with the style of each call and the other styles", async () => {
      const model = threeFine();

      await handlerFor(model)(requestWith({ secret: "x", description: { ...description, note: "y", furniture: [{ ...table, extra: 1 }, table, table, table] } }));

      expect(model.requests.map((request) => request.description)).toEqual([description, description, description]);
      expect(model.requests.map((request) => [request.style, request.alongside, request.avoid])).toEqual([
        ["spacious", ["cosy", "work"], []],
        ["cosy", ["spacious", "work"], []],
        ["work", ["spacious", "cosy"], []],
      ]);
    });

    it("adds to the count the browser already has", async () => {
      const res = await handlerFor(threeFine())(requestWith({ description }, { cookie: "ai_calls=4" }));

      expect(((await res.json()) as LayoutsResponse).calls).toEqual({ used: 7, limit: 10 });
      expect(res.headers.get("set-cookie")).toContain("ai_calls=7;");
    });

    it("says which pieces the app moved to stop them overlapping, for each layout, and gives layouts that are fine", async () => {
      // Two tables in the same place in the first layout.
      const overlapping = BACK.map((pose, index) => (index === 1 ? { ...pose, x_m: pose.x_m - 2, z_m: pose.z_m } : pose));
      const model = fakeModel({ spacious: [answerOf(overlapping)], cosy: [answerOf(MIDDLE)], work: [answerOf(FRONT)] });

      const [spacious, cosy] = await resultsOf(await handlerFor(model)(requestWith({ description })));

      expect(spacious.ok && spacious.adjusted.length).toBeGreaterThan(0);
      expect(spacious.ok && spacious.poses).toHaveLength(4);
      expect(spacious.ok && spacious.poses).not.toEqual(overlapping);
      expect(cosy.ok && cosy.adjusted).toEqual([]);
    });

    it("makes the styles at the same time, with one count of the session's calls that all of them share", async () => {
      const model = threeFine();
      const res = await handlerFor(model, 3)(requestWith({ description }));

      expect(res.status).toBe(200);
      expect(((await res.json()) as LayoutsResponse).calls).toEqual({ used: 3, limit: 3 });
    });
  });

  describe("some of the styles (AC4)", () => {
    it("makes only the styles that are asked for, in the order that they are asked for", async () => {
      const model = fakeModel({ work: [answerOf(FRONT)], spacious: [answerOf(BACK)] });

      const res = await handlerFor(model)(requestWith({ description, styles: ["work", "spacious"] }));

      const body = (await res.json()) as LayoutsResponse;
      expect(body.results.map((result) => result.style)).toEqual(["work", "spacious"]);
      expect(model.generate).toHaveBeenCalledTimes(2);
      expect(body.calls.used).toBe(2);
    });

    it("makes one style again, told where the layouts that are already made put the pieces, and counts one call", async () => {
      const model = fakeModel({ cosy: [answerOf(MIDDLE, "Snug.")] });
      const existing = [{ style: "spacious", poses: BACK }, { style: "work", poses: FRONT }];

      const res = await handlerFor(model)(requestWith({ description, styles: ["cosy"], existing }));

      expect(res.status).toBe(200);
      const body = (await res.json()) as LayoutsResponse;
      expect(body.results).toEqual([{ style: "cosy", ok: true, name: "Cosy", description: "Snug.", poses: MIDDLE, adjusted: [] }]);
      expect(body.calls).toEqual({ used: 1, limit: 10 });
      expect(model.requests[0]).toMatchObject({ style: "cosy", alongside: [], avoid: existing });
    });
  });

  describe("a style that has no layout while the others have (AC4)", () => {
    it("says why for that style, in a sentence for the user, and gives the other two, and counts both calls of the one that was asked twice", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [badAnswer, badAnswer], work: [answerOf(FRONT)] });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(res.status).toBe(200);
      const body = (await res.json()) as LayoutsResponse;
      expect(body.results.map((result) => result.ok)).toEqual([true, false, true]);
      expect(body.results[1]).toEqual({ style: "cosy", ok: false, name: "Cosy", code: "invalid_answer", message: "The AI could not make a usable Cosy layout this time." } satisfies StyleFailure);
      expect(body.calls).toEqual({ used: 4, limit: 10 });
      expect(res.headers.get("set-cookie")).toContain("ai_calls=4;");
    });

    it("uses the second answer of a style whose first was not a layout, and counts both calls", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [badAnswer, answerOf(MIDDLE)], work: [answerOf(FRONT)] });

      const res = await handlerFor(model)(requestWith({ description }));

      expect((await resultsOf(res)).every((result) => result.ok)).toBe(true);
      expect(model.requests.filter((request) => request.style === "cosy")[1].feedback).toMatch(/not valid JSON/);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=4;");
    });

    it("tells a style whose call failed that the service was not available, without the provider's error, and keeps the others", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [new Error("403 key=SECRET-KEY-123 is not allowed")], work: [answerOf(FRONT)] });

      const res = await handlerFor(model)(requestWith({ description }));
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(text).toContain("The AI service was not available for the Cosy layout. Please try again in a moment.");
      expect(text).not.toContain("SECRET-KEY-123");
      expect(res.headers.get("set-cookie")).toContain("ai_calls=3;");
      expect(console.error).toHaveBeenCalledWith("[layout] cosy: the model call failed:", expect.objectContaining({ message: expect.stringContaining("SECRET-KEY-123") }));
    });

    it("tells a style whose call says that the key is missing that the service was not available, when the other styles worked, without a word about the key", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [new MissingApiKeyError()], work: [answerOf(FRONT)] });

      const res = await handlerFor(model)(requestWith({ description }));
      const text = await res.text();

      expect(res.status).toBe(200);
      expect((JSON.parse(text) as LayoutsResponse).results[1]).toEqual({
        style: "cosy",
        ok: false,
        name: "Cosy",
        code: "ai_unavailable",
        message: "The AI service was not available for the Cosy layout. Please try again in a moment.",
      });
      expect(text).not.toContain("GEMINI_API_KEY");
      expect(text).not.toContain("server_misconfigured");
    });

    it("tells a style whose call ran out of time that the AI took too long, and not that the service was down, and keeps the others", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [new AiTimeoutError(120_000)], work: [answerOf(FRONT)] });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(res.status).toBe(200);
      const body = (await res.json()) as LayoutsResponse;
      expect(body.results.map((result) => result.ok)).toEqual([true, false, true]);
      expect(body.results[1]).toEqual({ style: "cosy", ok: false, name: "Cosy", code: "timed_out", message: "The AI took too long to make the Cosy layout. Please try again." } satisfies StyleFailure);
      // The call was counted, and not asked again.
      expect(body.calls).toEqual({ used: 3, limit: 10 });
      expect(model.generate).toHaveBeenCalledTimes(3);
    });

    it("writes the deadline that ran out in the log, with what Gemini said", async () => {
      const cause = new Error("504 DEADLINE_EXCEEDED");
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [new AiTimeoutError(120_000, { cause })], work: [answerOf(FRONT)] });

      await handlerFor(model)(requestWith({ description }));

      expect(console.error).toHaveBeenCalledWith("[layout] cosy: The model did not answer within 120 s.", cause);
    });

    it("warns in the log, for each layout whose answer had no description that could be used, and for no other", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK, "Open and airy.")], cosy: [answerOf(MIDDLE)], work: [answerOf(FRONT, "x".repeat(400))] });

      await handlerFor(model)(requestWith({ description }));

      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalledWith("[layout] cosy: the answer had no description that could be used, so the layout has the idea of its style.");
      expect(console.warn).toHaveBeenCalledWith("[layout] work: the answer had no description that could be used, so the layout has the idea of its style.");
    });

    it("does not warn when every answer had a description", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK, "One.")], cosy: [answerOf(MIDDLE, "Two.")], work: [answerOf(FRONT, "Three.")] });

      await handlerFor(model)(requestWith({ description }));

      expect(console.warn).not.toHaveBeenCalled();
    });

    it("writes what was wrong with the answers in the log, and not in the answer to the browser", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [badAnswer, badAnswer], work: [answerOf(FRONT)] });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(console.error).toHaveBeenCalledWith("[layout] cosy: invalid answers from the model:", expect.arrayContaining([expect.stringContaining("not valid JSON")]));
      expect(await res.text()).not.toContain("not valid JSON");
    });

    it("says that a layout was too much like the others, with how many pieces were in places of their own and how many are needed, after one more try", async () => {
      const similar = along(0, -1.5, -1.5, -1.5);
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(similar), answerOf(similar)], work: [answerOf(FRONT)] });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(res.status).toBe(200);
      const body = (await res.json()) as LayoutsResponse;
      expect(body.results.map((result) => result.ok)).toEqual([true, false, true]);
      expect(body.results[1]).toEqual({
        style: "cosy",
        ok: false,
        name: "Cosy",
        code: "too_similar",
        message: "The Cosy layout was too much like the others: only 1 of 4 pieces was in a different place, and at least 2 are needed.",
      });
      expect(body.calls.used).toBe(4);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[layout] cosy: too like the other layouts: 1 of 4 pieces in places of their own, 2 needed."));
    });

    it("says it right when no piece was in a place of its own, and in the plural", async () => {
      const model = fakeModel({ spacious: [answerOf(BACK)], cosy: [answerOf(BACK), answerOf(BACK)], work: [answerOf(FRONT)] });

      const results = await resultsOf(await handlerFor(model)(requestWith({ description })));

      expect(results[1].ok === false && results[1].message).toBe("The Cosy layout was too much like the others: only 0 of 4 pieces were in a different place, and at least 2 are needed.");
    });

    it("says it right for a room with one piece, which needs one", async () => {
      const one = { room, furniture: [table] };
      const at = (z: number): ModelAnswer => answerOf(along(z));
      const model = fakeModel({ spacious: [at(-1.5)], cosy: [at(-1.4), at(-1.4)] });

      const results = await resultsOf(await handlerFor(model)(requestWith({ description: one, styles: ["spacious", "cosy"] })));

      expect(results[1].ok === false && results[1].message).toBe("The Cosy layout was too much like the others: only 0 of 1 pieces were in a different place, and at least 1 is needed.");
    });

    it("tells the style that ran into the limit of calls that the session is used up, and gives the layouts that were made", async () => {
      const model = threeFine();

      const res = await handlerFor(model, 2)(requestWith({ description }));

      expect(res.status).toBe(200);
      const body = (await res.json()) as LayoutsResponse;
      expect(body.results.map((result) => result.ok)).toEqual([true, true, false]);
      expect(body.results[2]).toEqual({ style: "work", ok: false, name: "Work-focused", code: "limit_reached", message: "You have used all 2 AI calls for this session." });
      expect(body.calls).toEqual({ used: 2, limit: 2 });
      expect(res.headers.get("set-cookie")).toContain("ai_calls=2;");
      expect(model.generate).toHaveBeenCalledTimes(2);
    });
  });

  describe("no layout at all", () => {
    it("is an error for the whole request, as it was for one layout, when the answers were not layouts: 502, with every call counted", async () => {
      const model = fakeModel({ spacious: [badAnswer, badAnswer], cosy: [badAnswer, badAnswer], work: [badAnswer, badAnswer] });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(res.status).toBe(502);
      expect(await failure(res)).toEqual({
        error: { code: "invalid_answer", message: "The AI could not make a usable layout this time. Please try again." },
        calls: { used: 6, limit: 10 },
      });
      expect(res.headers.get("set-cookie")).toContain("ai_calls=6;");
    });

    it("says that furniture still overlapped when the app could not fix any of the layouts, and counts a call for each", async () => {
      // Two long thin pieces, each across the whole of a room of 1 m x 1 m in a different way: they cross wherever they are put.
      const across = { ...typicalItem("bookshelf"), width_cm: 100, depth_cm: 10 };
      const upright = { ...typicalItem("bookshelf"), width_cm: 10, depth_cm: 100 };
      const crossing = { room: { ...room, width_m: 1, length_m: 1 }, furniture: [across, upright] };
      const poses: Pose[] = [{ x_m: 0, z_m: 0, rotation_deg: 0 }, { x_m: 0, z_m: 0, rotation_deg: 0 }];
      const answer = { text: JSON.stringify({ pieces: poses.map((pose, index) => ({ index, label: "bookshelf", ...pose })) }) };
      const model = fakeModel({ spacious: [answer], cosy: [answer], work: [answer] });

      const res = await handlerFor(model)(requestWith({ description: crossing }));

      expect(res.status).toBe(502);
      expect(await failure(res)).toEqual({
        error: {
          code: "layout_has_overlaps",
          message: "The layout that the AI made still had furniture overlapping after the app tried to fix it. Please try again, or check the size of the room and of the furniture.",
        },
        calls: { used: 3, limit: 10 },
      });
      expect(model.generate).toHaveBeenCalledTimes(3); // a layout that is not fine is not asked for again
      expect(console.error).toHaveBeenCalledWith("[layout] spacious: pieces still overlap after fixing:", expect.arrayContaining([expect.stringContaining("Bookshelf (item")]));
    });

    it("is a 503 that hides the provider's error from the user, when every call failed, but still counts the calls", async () => {
      const down = () => [new Error("403 key=SECRET-KEY-123 is not allowed")];
      const model = fakeModel({ spacious: down(), cosy: down(), work: down() });

      const res = await handlerFor(model)(requestWith({ description }));
      const text = await res.text();

      expect(res.status).toBe(503);
      expect(text).toContain("ai_unavailable");
      expect(text).toContain("The AI service is not available right now. Please try again in a moment.");
      expect(text).not.toContain("SECRET-KEY-123");
      expect(res.headers.get("set-cookie")).toContain("ai_calls=3;");
      expect(model.generate).toHaveBeenCalledTimes(3); // call errors are not retried
    });

    it("is a 502 and not a 429 when only some of the styles ran into the limit and the others gave answers that were not layouts", async () => {
      // Four calls: the three first tries are not layouts, the first style has the fourth call for its second try, and the second and the third are over the limit.
      const bad = () => [badAnswer, badAnswer];
      const model = fakeModel({ spacious: bad(), cosy: bad(), work: bad() });

      const res = await handlerFor(model, 4)(requestWith({ description }));

      expect(res.status).toBe(502);
      expect((await failure(res)).error.code).toBe("invalid_answer");
      expect(model.generate).toHaveBeenCalledTimes(4);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=4;");
    });

    it("is a 504 that says the AI took too long, when every call ran out of time, and counts the calls without asking again", async () => {
      const late = () => [new AiTimeoutError(120_000)];
      const model = fakeModel({ spacious: late(), cosy: late(), work: late() });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(res.status).toBe(504);
      expect(await failure(res)).toEqual({
        error: { code: "timed_out", message: "The AI took too long to make the layouts. Please try again." },
        calls: { used: 3, limit: 10 },
      });
      expect(model.generate).toHaveBeenCalledTimes(3);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=3;");
    });

    it("is a 504, and not a 502, when some calls ran out of time and the others gave answers that were not layouts: the time is what to say", async () => {
      const model = fakeModel({ spacious: [new AiTimeoutError(120_000)], cosy: [badAnswer, badAnswer], work: [badAnswer, badAnswer] });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(res.status).toBe(504);
      expect((await failure(res)).error.code).toBe("timed_out");
    });

    it("is a 503, and not a 504, when a call ran out of time and another found the service down: the service is what to say", async () => {
      const model = fakeModel({ spacious: [new AiTimeoutError(120_000)], cosy: [new Error("503 overloaded")], work: [new AiTimeoutError(120_000)] });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(res.status).toBe(503);
    });

    it("is a 504, and not a 429, when the one call that was left ran out of time and the others never started", async () => {
      const model = fakeModel({ spacious: [new AiTimeoutError(120_000)], cosy: [answerOf(MIDDLE)], work: [answerOf(FRONT)] });

      // One call left: the first style has it and runs out of time, and the other two are over the limit.
      const res = await handlerFor(model)(requestWith({ description }, { cookie: "ai_calls=9" }));

      expect(res.status).toBe(504);
      expect(model.generate).toHaveBeenCalledTimes(1);
    });

    it("is a 503 when one call failed and the others gave answers that were not layouts: the service is what to say", async () => {
      const model = fakeModel({ spacious: [new Error("503")], cosy: [badAnswer, badAnswer], work: [badAnswer, badAnswer] });

      const res = await handlerFor(model)(requestWith({ description }));

      expect(res.status).toBe(503);
    });

    it("says only that the server is not set up when the API key is missing, and writes it in the log", async () => {
      const missing = () => [new MissingApiKeyError()];
      const model = fakeModel({ spacious: missing(), cosy: missing(), work: missing() });

      const res = await handlerFor(model)(requestWith({ description }));
      const text = await res.text();

      expect(res.status).toBe(500);
      expect(text).toContain("server_misconfigured");
      expect(text).toContain("The server is not set up for AI requests yet.");
      expect(text).not.toContain("GEMINI_API_KEY");
      expect(console.error).toHaveBeenCalledWith("[layout]", expect.stringContaining("GEMINI_API_KEY"));
    });

    it("is a 502 that says the layout was too much like the others when the one style that was made again was", async () => {
      const model = fakeModel({ cosy: [answerOf(BACK)] });
      const existing = [{ style: "spacious", poses: BACK }, { style: "work", poses: FRONT }];

      const res = await handlerFor(model)(requestWith({ description, styles: ["cosy"], existing }));

      expect(res.status).toBe(502);
      expect(await failure(res)).toEqual({
        error: { code: "too_similar", message: "The Cosy layout was too much like the others: only 0 of 4 pieces were in a different place, and at least 2 are needed." },
        calls: { used: 1, limit: 10 },
      });
      expect(model.generate).toHaveBeenCalledTimes(1);
    });

    it("is a 429 when every style ran into the limit, which is told as it is for a session that is used up", async () => {
      // One call left: the first style uses it and is not a layout, so its second call is over the limit, and the others never start.
      const model = fakeModel({ spacious: [badAnswer, badAnswer], cosy: [answerOf(MIDDLE)], work: [answerOf(FRONT)] });

      const res = await handlerFor(model)(requestWith({ description }, { cookie: "ai_calls=9" }));

      expect(res.status).toBe(429);
      expect(await failure(res)).toEqual({
        error: { code: "limit_reached", message: "You have used all 10 AI calls for this session." },
        calls: { used: 10, limit: 10 },
      });
      expect(model.generate).toHaveBeenCalledTimes(1);
      expect(res.headers.get("set-cookie")).toContain("ai_calls=10;");
    });
  });

  describe("the call limit", () => {
    it("blocks a session that has used up its calls, without calling the model", async () => {
      const model = threeFine();

      const res = await handlerFor(model)(requestWith({ description }, { cookie: "ai_calls=10" }));

      expect(res.status).toBe(429);
      expect(await failure(res)).toEqual({
        error: { code: "limit_reached", message: "You have used all 10 AI calls for this session." },
        calls: { used: 10, limit: 10 },
      });
      expect(model.generate).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull(); // nothing changed
    });

    it("blocks without even reading the request", async () => {
      const model = threeFine();

      const res = await handlerFor(model)(requestWith("this is not a request", { cookie: "ai_calls=10" }));

      expect(res.status).toBe(429);
      expect(model.generate).not.toHaveBeenCalled();
    });

    it("uses the limit it is given", async () => {
      const model = threeFine();

      const res = await handlerFor(model, 2)(requestWith({ description }, { cookie: "ai_calls=2" }));

      expect(res.status).toBe(429);
      expect((await failure(res)).calls).toEqual({ used: 2, limit: 2 });
      expect(model.generate).not.toHaveBeenCalled();
    });

    it("lets a session with calls left make as many layouts as it has calls, and no more", async () => {
      const model = threeFine();

      const res = await handlerFor(model)(requestWith({ description }, { cookie: "ai_calls=8" }));

      expect(res.status).toBe(200);
      expect(((await res.json()) as LayoutsResponse).calls).toEqual({ used: 10, limit: 10 });
      expect(model.generate).toHaveBeenCalledTimes(2);
    });
  });

  describe("a request that is not a valid request for layouts", () => {
    it.each([
      ["text that is not JSON", () => requestWith("sofa, table")],
      ["an empty body", () => requestWith("")],
      ["a list instead of an object", () => requestWith([])],
      ["no description", () => requestWith({ styles: ["cosy"] })],
      ["a room description at the top, as it was before styles", () => requestWith(description)],
      ["no furniture", () => requestWith({ description: { room, furniture: [] } })],
      ["a piece without a size", () => requestWith({ description: { room, furniture: [{ ...table, width_cm: undefined }] } })],
      ["a room that is too small", () => requestWith({ description: { room: { ...room, width_m: 0.2 }, furniture: [table] } })],
      ["a style that does not exist", () => requestWith({ description, styles: ["loud"] })],
      ["no styles", () => requestWith({ description, styles: [] })],
      ["a style twice", () => requestWith({ description, styles: ["cosy", "cosy"] })],
      ["a layout that is already made for a style that is asked for", () => requestWith({ description, styles: ["cosy"], existing: [{ style: "cosy", poses: BACK }] })],
      ["a layout that is already made with too few places", () => requestWith({ description, styles: ["cosy"], existing: [{ style: "work", poses: BACK.slice(0, 2) }] })],
    ])("rejects %s, without calling the model or counting a call", async (_name, makeRequest) => {
      const model = threeFine();

      const res = await handlerFor(model)(makeRequest());

      expect(res.status).toBe(400);
      expect((await failure(res)).error.code).toBe("invalid_request");
      expect((await failure(await handlerFor(model)(makeRequest()))).error.message).toMatch(/^The request is not valid\./);
      expect(model.generate).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    it("says what is wrong, in sentences, and which piece", async () => {
      const res = await handlerFor(threeFine())(requestWith({ description: { room, furniture: [table, { ...table, depth_cm: 0 }] } }));

      expect((await failure(res)).error.message).toContain("Furniture item 2 (Side table)");
    });

    it(`rejects more than ${MAX_LAYOUT_PIECES} pieces`, async () => {
      const model = threeFine();

      const res = await handlerFor(model)(requestWith({ description: { room, furniture: Array.from({ length: MAX_LAYOUT_PIECES + 1 }, () => table) } }));

      expect(res.status).toBe(400);
      expect((await failure(res)).error.message).toContain(`at most ${MAX_LAYOUT_PIECES} pieces`);
      expect(model.generate).not.toHaveBeenCalled();
    });

    it("rejects a request that announces a huge size before reading it", async () => {
      const model = threeFine();

      const res = await handlerFor(model)(requestWith({ description }, { "content-length": String(10 * 1024 * 1024) }));

      expect(res.status).toBe(413);
      expect((await failure(res)).error).toEqual({ code: "invalid_description", message: "The room description is too large." });
      expect(model.generate).not.toHaveBeenCalled();
    });

    it("rejects a body that is huge although it did not say so", async () => {
      const model = threeFine();
      const huge = JSON.stringify({ description, notes: "x".repeat(70 * 1024) });

      const res = await handlerFor(model)(new Request("http://localhost/api/layout", { method: "POST", body: huge }));

      expect(res.status).toBe(413);
      expect(model.generate).not.toHaveBeenCalled();
    });
  });

  describe("a room that cannot hold its furniture", () => {
    it("is refused before the model is asked, with a message that says why, and no call is counted", async () => {
      const model = threeFine();
      const sofa = { ...typicalItem("sofa"), width_cm: 200, depth_cm: 90 };
      const full = { room: { width_m: 4, length_m: 3, height_m: 2.5 }, furniture: Array.from({ length: 6 }, () => sofa) };

      const res = await handlerFor(model)(requestWith({ description: full }));

      expect(res.status).toBe(422);
      const { error, calls } = await failure(res);
      expect(error.code).toBe("room_too_full");
      expect(error.message).toBe("Your furniture would cover 90% of the floor, which leaves no room for a layout without overlaps. Check the size of the room, or take some furniture out of the list.");
      expect(calls).toEqual({ used: 0, limit: 10 });
      expect(model.generate).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  });

  it("asks for every style that there is when no styles are given, which are the three of the page", async () => {
    const model = threeFine();

    await handlerFor(model)(requestWith({ description }));

    expect(model.requests.map((request) => request.style)).toEqual([...LAYOUT_STYLES]);
  });
});
