import { describe, expect, it, vi } from "vitest";
import type { ApiErrorCode, LayoutResponse } from "../shared/api";
import { typicalItem } from "../shared/furniture";
import type { Pose } from "../shared/layout";
import { requestLayout } from "./layout-client";

const description = {
  room: { width_m: 5, length_m: 4, height_m: 2.5 },
  furniture: [typicalItem("sofa"), typicalItem("coffee_table")],
};
const layout: Pose[] = [
  { x_m: 0, z_m: 1.45, rotation_deg: 180 },
  { x_m: 0, z_m: 0.35, rotation_deg: 0 },
];
const success: LayoutResponse = { layout, adjusted: [1], calls: { used: 1, limit: 10 } };

const respond = (body: unknown, status = 200) => vi.fn(async () => Response.json(body, { status }));
const failureBody = (code: ApiErrorCode, message = "Something is wrong.", calls = { used: 2, limit: 10 }) => ({ error: { code, message }, calls });

describe("requestLayout", () => {
  it("sends the room description as JSON to /api/layout, and gives the layout", async () => {
    const send = respond(success);

    const outcome = await requestLayout(description, { send });

    expect(outcome).toEqual({ ok: true, data: success });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/layout");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(description);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives a layout in which the first piece and the last were moved", async () => {
    const both = { ...success, adjusted: [0, 1] };

    expect(await requestLayout(description, { send: respond(both) })).toEqual({ ok: true, data: both });
  });

  it("gives up after 150 seconds, longer than the two calls of up to a minute that the server may make", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await requestLayout(description, { send: respond(success) });

    expect(timeout).toHaveBeenCalledWith(150_000);
    timeout.mockRestore();
  });

  describe("a failure that the server explains", () => {
    it.each([
      ["invalid_answer", 502, true],
      ["layout_has_overlaps", 502, true],
      ["ai_unavailable", 503, true],
      ["limit_reached", 429, false],
      ["room_too_full", 422, false],
      ["invalid_description", 400, false],
      ["server_misconfigured", 500, false],
    ] as [ApiErrorCode, number, boolean][])("gives its message and the calls for %s, and says whether asking again can help", async (code, status, retryable) => {
      const send = respond(failureBody(code, "Words for the user."), status);

      const outcome = await requestLayout(description, { send });

      expect(outcome).toEqual({ ok: false, failure: { code, message: "Words for the user.", retryable, calls: { used: 2, limit: 10 } } });
    });

    it("copes with a failure that has no calls in it", async () => {
      const send = respond({ error: { code: "ai_unavailable", message: "Not now." } }, 503);

      const outcome = await requestLayout(description, { send });

      expect(outcome).toEqual({ ok: false, failure: { code: "ai_unavailable", message: "Not now.", retryable: true, calls: undefined } });
    });
  });

  describe("a failure whose calls are not calls", () => {
    it("leaves the calls out", async () => {
      const send = respond({ error: { code: "ai_unavailable", message: "Not now." }, calls: "ten" }, 503);

      const outcome = await requestLayout(description, { send });

      expect(outcome).toEqual({ ok: false, failure: { code: "ai_unavailable", message: "Not now.", retryable: true, calls: undefined } });
    });
  });

  describe("a request that did not get an answer", () => {
    it("says that the server could not be reached, and that asking again can help", async () => {
      const send = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      const outcome = await requestLayout(description, { send });

      expect(outcome).toEqual({
        ok: false,
        failure: { code: "network", message: "We could not reach the server. Check your internet connection and try again.", retryable: true },
      });
    });

    it("says that it is taking longer than expected when the time is up", async () => {
      const send = vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));

      const outcome = await requestLayout(description, { send });

      expect(outcome).toEqual({ ok: false, failure: { code: "network", message: "This is taking longer than expected. Please try again.", retryable: true } });
    });
  });

  describe("an answer that is not one of ours", () => {
    const wrong = { code: "ai_unavailable", message: "Something went wrong on our side. Please try again.", retryable: true };

    it.each([
      ["text that is not JSON", () => vi.fn(async () => new Response("<html>oops</html>", { status: 200 }))],
      ["a page for an error", () => vi.fn(async () => new Response("Bad gateway", { status: 502 }))],
      ["an object that is not a layout", () => respond({ items: [] })],
      ["a layout with a place missing", () => respond({ ...success, layout: [layout[0]] })],
      ["a layout with a place too many", () => respond({ ...success, layout: [...layout, layout[0]] })],
      ["a place that is not numbers", () => respond({ ...success, layout: [layout[0], { x_m: "0", z_m: 0, rotation_deg: 0 }] })],
      ["a place that is not numbers in z", () => respond({ ...success, layout: [layout[0], { x_m: 0, z_m: "0", rotation_deg: 0 }] })],
      ["a place that is not numbers in the rotation", () => respond({ ...success, layout: [layout[0], { x_m: 0, z_m: 0, rotation_deg: null }] })],
      ["a place that is not an object", () => respond({ ...success, layout: [layout[0], null] })],
      // JSON has no infinity, but a number written like this is read as one.
      ["a place that is not finite", () => vi.fn(async () => new Response('{"layout":[{"x_m":0,"z_m":1.45,"rotation_deg":180},{"x_m":1e999,"z_m":0,"rotation_deg":0}],"adjusted":[],"calls":{"used":1,"limit":10}}'))],
      ["pieces moved that are not in the list", () => respond({ ...success, adjusted: [5] })],
      ["pieces moved that are not whole numbers", () => respond({ ...success, adjusted: [0.5] })],
      ["pieces moved that are not a list", () => respond({ ...success, adjusted: "1" })],
      ["no list of pieces moved", () => respond({ layout, calls: success.calls })],
      ["a piece moved that is one past the end of the list", () => respond({ ...success, adjusted: [2] })],
      ["a piece moved with a negative number", () => respond({ ...success, adjusted: [-1] })],
      ["an error with a code that is not text", () => respond({ error: { code: 502, message: "No." }, calls: success.calls }, 502)],
      ["an error with no message", () => respond({ error: { code: "ai_unavailable" }, calls: success.calls }, 503)],
      ["an error with a message that is not text", () => respond({ error: { code: "ai_unavailable", message: 5 }, calls: success.calls }, 503)],
      ["no calls", () => respond({ layout, adjusted: [] })],
      ["a layout that comes with an error status", () => respond(success, 500)],
    ])("is a failure that asking again can help, for %s", async (_name, makeSend) => {
      const outcome = await requestLayout(description, { send: makeSend() });

      expect(outcome).toEqual({ ok: false, failure: wrong });
    });
  });
});
