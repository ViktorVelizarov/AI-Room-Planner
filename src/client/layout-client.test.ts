import { describe, expect, it, vi } from "vitest";
import type { ApiErrorCode, LayoutsRequestBody, LayoutsResponse, StyleResult } from "../shared/api";
import { typicalItem } from "../shared/furniture";
import type { Pose } from "../shared/layout";
import { requestLayout } from "./layout-client";

const description = {
  room: { width_m: 5, length_m: 4, height_m: 2.5 },
  furniture: [typicalItem("sofa"), typicalItem("coffee_table")],
};
const poses: Pose[] = [
  { x_m: 0, z_m: 1.45, rotation_deg: 180 },
  { x_m: 0, z_m: 0.35, rotation_deg: 0 },
];
const made = (style: "spacious" | "cosy" | "work", name: string, overrides: object = {}): StyleResult => ({
  style,
  ok: true,
  name,
  description: `The ${name} idea.`,
  poses,
  adjusted: [1],
  ...overrides,
}) as StyleResult;
const failed = (style: "spacious" | "cosy" | "work", name: string): StyleResult => ({ style, ok: false, name, code: "invalid_answer", message: `No ${name} layout.` });

const three: StyleResult[] = [made("spacious", "Spacious"), made("cosy", "Cosy"), made("work", "Work-focused")];
const success: LayoutsResponse = { results: three, calls: { used: 3, limit: 10 } };

const respond = (body: unknown, status = 200) => vi.fn(async () => Response.json(body, { status }));
const failureBody = (code: ApiErrorCode, message = "Something is wrong.", calls = { used: 2, limit: 10 }) => ({ error: { code, message }, calls });
const sentBody = (send: ReturnType<typeof respond>) => JSON.parse(((send.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)) as LayoutsRequestBody;

describe("requestLayout", () => {
  it("sends the room description as JSON to /api/layout, and gives the layouts", async () => {
    const send = respond(success);

    const outcome = await requestLayout(description, {}, { send });

    expect(outcome).toEqual({ ok: true, data: success });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/layout");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ description });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("asks for all the styles when it is not told which, and says nothing about styles or layouts that are made", async () => {
    const send = respond(success);

    await requestLayout(description, {}, { send });
    await requestLayout(description, undefined, { send });
    await requestLayout(description, { styles: [], existing: [] }, { send });

    for (const call of send.mock.calls as unknown as [string, RequestInit][]) {
      expect(Object.keys(JSON.parse(call[1].body as string))).toEqual(["description"]);
    }
  });

  it("asks for the styles that it is told, and gives the layouts that are made, for one style to be made again", async () => {
    const send = respond({ results: [made("cosy", "Cosy")], calls: { used: 1, limit: 10 } });

    const outcome = await requestLayout(description, { styles: ["cosy"], existing: [{ style: "spacious", poses }, { style: "work", poses }] }, { send });

    expect(outcome.ok).toBe(true);
    expect(sentBody(send)).toEqual({
      description,
      styles: ["cosy"],
      existing: [{ style: "spacious", poses }, { style: "work", poses }],
    });
  });

  it("gives a layout with its name and its description, and says which pieces were moved", async () => {
    const outcome = await requestLayout(description, {}, { send: respond(success) });

    expect(outcome.ok && outcome.data.results[0]).toEqual({ style: "spacious", ok: true, name: "Spacious", description: "The Spacious idea.", poses, adjusted: [1] });
  });

  it("gives the styles that have no layout, with why, as long as one has", async () => {
    const some: LayoutsResponse = { results: [made("spacious", "Spacious"), failed("cosy", "Cosy"), made("work", "Work-focused")], calls: { used: 4, limit: 10 } };

    expect(await requestLayout(description, {}, { send: respond(some) })).toEqual({ ok: true, data: some });
  });

  it("gives a style that ran out of time, with its message, as a style that has no layout", async () => {
    const late: LayoutsResponse = {
      results: [made("spacious", "Spacious"), { style: "cosy", ok: false, name: "Cosy", code: "timed_out", message: "The AI took too long to make the Cosy layout. Please try again." }, made("work", "Work-focused")],
      calls: { used: 3, limit: 10 },
    };

    expect(await requestLayout(description, {}, { send: respond(late) })).toEqual({ ok: true, data: late });
  });

  it("gives the answer for one style when one is asked for", async () => {
    const one: LayoutsResponse = { results: [made("work", "Work-focused")], calls: { used: 1, limit: 10 } };

    expect(await requestLayout(description, { styles: ["work"] }, { send: respond(one) })).toEqual({ ok: true, data: one });
  });

  it("gives up after 10 minutes, longer than the two rounds of two calls of up to 150 seconds that the server may make", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await requestLayout(description, {}, { send: respond(success) });

    expect(timeout).toHaveBeenCalledWith(600_000);
    timeout.mockRestore();
  });

  describe("a failure that the server explains", () => {
    it.each([
      ["invalid_answer", 502, true],
      ["layout_has_overlaps", 502, true],
      ["too_similar", 502, true],
      ["ai_unavailable", 503, true],
      ["timed_out", 504, true],
      ["limit_reached", 429, false],
      ["room_too_full", 422, false],
      ["invalid_description", 400, false],
      ["invalid_request", 400, false],
      ["server_misconfigured", 500, false],
    ] as [ApiErrorCode, number, boolean][])("gives its message and the calls for %s, and says whether asking again can help", async (code, status, retryable) => {
      const send = respond(failureBody(code, "Words for the user."), status);

      const outcome = await requestLayout(description, {}, { send });

      expect(outcome).toEqual({ ok: false, failure: { code, message: "Words for the user.", retryable, calls: { used: 2, limit: 10 } } });
    });

    it("copes with a failure that has no calls in it", async () => {
      const send = respond({ error: { code: "ai_unavailable", message: "Not now." } }, 503);

      const outcome = await requestLayout(description, {}, { send });

      expect(outcome).toEqual({ ok: false, failure: { code: "ai_unavailable", message: "Not now.", retryable: true, calls: undefined } });
    });
  });

  describe("a failure whose calls are not calls", () => {
    it("leaves the calls out", async () => {
      const send = respond({ error: { code: "ai_unavailable", message: "Not now." }, calls: "ten" }, 503);

      const outcome = await requestLayout(description, {}, { send });

      expect(outcome).toEqual({ ok: false, failure: { code: "ai_unavailable", message: "Not now.", retryable: true, calls: undefined } });
    });
  });

  describe("a request that did not get an answer", () => {
    it("says that the server could not be reached, and that asking again can help", async () => {
      const send = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      const outcome = await requestLayout(description, {}, { send });

      expect(outcome).toEqual({
        ok: false,
        failure: { code: "network", message: "We could not reach the server. Check your internet connection and try again.", retryable: true },
      });
    });

    it("says that it is taking longer than expected when the time is up", async () => {
      const send = vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));

      const outcome = await requestLayout(description, {}, { send });

      expect(outcome).toEqual({ ok: false, failure: { code: "network", message: "This is taking longer than expected. Please try again.", retryable: true } });
    });
  });

  describe("an answer that is not one of ours", () => {
    const wrong = { code: "ai_unavailable", message: "Something went wrong on our side. Please try again.", retryable: true };
    const calls = { used: 3, limit: 10 };
    const withResults = (results: unknown[]) => respond({ results, calls });

    it.each([
      ["text that is not JSON", () => vi.fn(async () => new Response("<html>oops</html>", { status: 200 }))],
      ["a page for an error", () => vi.fn(async () => new Response("Bad gateway", { status: 502 }))],
      ["an object that is not layouts", () => respond({ items: [] })],
      ["a single layout, as the server answered before styles", () => respond({ layout: poses, adjusted: [], calls })],
      ["no results", () => withResults([])],
      ["results that are not a list", () => respond({ results: "three", calls })],
      ["only some of the styles that were asked for", () => withResults(three.slice(0, 2))],
      ["more results than styles", () => withResults([...three, three[0]])],
      ["the styles in another order", () => withResults([three[1], three[0], three[2]])],
      ["a style twice", () => withResults([three[0], three[0], three[2]])],
      ["a style that does not exist", () => withResults([three[0], made("cosy", "Cosy", { style: "loud" }), three[2]])],
      ["every style failed, which is an error and not an answer", () => withResults([failed("spacious", "Spacious"), failed("cosy", "Cosy"), failed("work", "Work-focused")])],
      ["a result with no name", () => withResults([three[0], made("cosy", "Cosy", { name: undefined }), three[2]])],
      ["a layout with no description", () => withResults([three[0], made("cosy", "Cosy", { description: undefined }), three[2]])],
      ["a layout with a description that is not text", () => withResults([three[0], made("cosy", "Cosy", { description: 5 }), three[2]])],
      ["a layout with a place missing", () => withResults([three[0], made("cosy", "Cosy", { poses: [poses[0]] }), three[2]])],
      ["a layout with a place too many", () => withResults([three[0], made("cosy", "Cosy", { poses: [...poses, poses[0]] }), three[2]])],
      ["a place that is not numbers", () => withResults([three[0], made("cosy", "Cosy", { poses: [poses[0], { x_m: "0", z_m: 0, rotation_deg: 0 }] }), three[2]])],
      ["a place that is not numbers in z", () => withResults([three[0], made("cosy", "Cosy", { poses: [poses[0], { x_m: 0, z_m: "0", rotation_deg: 0 }] }), three[2]])],
      ["a place that is not numbers in the rotation", () => withResults([three[0], made("cosy", "Cosy", { poses: [poses[0], { x_m: 0, z_m: 0, rotation_deg: null }] }), three[2]])],
      ["a place that is not an object", () => withResults([three[0], made("cosy", "Cosy", { poses: [poses[0], null] }), three[2]])],
      // JSON has no infinity, but a number written like this is read as one.
      ["a place that is not finite", () => vi.fn(async () => new Response('{"results":[{"style":"spacious","ok":true,"name":"Spacious","description":"x","poses":[{"x_m":0,"z_m":1.45,"rotation_deg":180},{"x_m":1e999,"z_m":0,"rotation_deg":0}],"adjusted":[]},{"style":"cosy","ok":false,"name":"Cosy","code":"invalid_answer","message":"No."},{"style":"work","ok":false,"name":"Work-focused","code":"invalid_answer","message":"No."}],"calls":{"used":3,"limit":10}}'))],
      ["pieces moved that are not in the list", () => withResults([three[0], made("cosy", "Cosy", { adjusted: [5] }), three[2]])],
      ["pieces moved that are not whole numbers", () => withResults([three[0], made("cosy", "Cosy", { adjusted: [0.5] }), three[2]])],
      ["pieces moved that are not a list", () => withResults([three[0], made("cosy", "Cosy", { adjusted: "1" }), three[2]])],
      ["no list of pieces moved", () => withResults([three[0], made("cosy", "Cosy", { adjusted: undefined }), three[2]])],
      ["a piece moved that is one past the end of the list", () => withResults([three[0], made("cosy", "Cosy", { adjusted: [2] }), three[2]])],
      ["a piece moved with a negative number", () => withResults([three[0], made("cosy", "Cosy", { adjusted: [-1] }), three[2]])],
      ["a failure with a code that is not one of the styles'", () => withResults([three[0], { style: "cosy", ok: false, name: "Cosy", code: "room_too_full", message: "No." }, three[2]])],
      ["a failure with no message", () => withResults([three[0], { style: "cosy", ok: false, name: "Cosy", code: "invalid_answer" }, three[2]])],
      ["a failure with a message that is not text", () => withResults([three[0], { style: "cosy", ok: false, name: "Cosy", code: "invalid_answer", message: 5 }, three[2]])],
      ["a result that says neither that it worked nor that it did not", () => withResults([three[0], made("cosy", "Cosy", { ok: "yes" }), three[2]])],
      ["a result that is not an object", () => withResults([three[0], null, three[2]])],
      ["an error with a code that is not text", () => respond({ error: { code: 502, message: "No." }, calls }, 502)],
      ["an error with no message", () => respond({ error: { code: "ai_unavailable" }, calls }, 503)],
      ["an error with a message that is not text", () => respond({ error: { code: "ai_unavailable", message: 5 }, calls }, 503)],
      ["no calls", () => respond({ results: three })],
      ["layouts that come with an error status", () => respond(success, 500)],
    ])("is a failure that asking again can help, for %s", async (_name, makeSend) => {
      const outcome = await requestLayout(description, {}, { send: makeSend() });

      expect(outcome).toEqual({ ok: false, failure: wrong });
    });

    it("is one too when the answer has the styles in the wrong order for the styles that were asked for", async () => {
      const outcome = await requestLayout(description, { styles: ["work", "spacious"] }, { send: respond({ results: [three[0], three[2]], calls }) });

      expect(outcome).toEqual({ ok: false, failure: wrong });
    });

    it("takes the answer for the styles that were asked for, in the order that they were asked for", async () => {
      const results = [three[2], three[0]];

      const outcome = await requestLayout(description, { styles: ["work", "spacious"] }, { send: respond({ results, calls }) });

      expect(outcome).toEqual({ ok: true, data: { results, calls } });
    });
  });
});
