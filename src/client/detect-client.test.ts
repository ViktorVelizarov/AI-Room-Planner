import { describe, expect, it, vi } from "vitest";
import type { ApiFailure, DetectResponse } from "../shared/api";
import { requestDetection } from "./detect-client";

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

const success: DetectResponse = {
  items: [
    { label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "grey", material: "fabric" },
  ],
  unsupported: 0,
  calls: { used: 1, limit: 10 },
};

const failureBody = (code: ApiFailure["error"]["code"], message = "Something happened."): ApiFailure => ({
  error: { code, message },
  calls: { used: 2, limit: 10 },
});

const reply = (body: unknown, status = 200) => async () => Response.json(body, { status });

describe("requestDetection", () => {
  it("sends every prepared photo, in order, as one request", async () => {
    const send = vi.fn(reply(success));
    const prepare = vi.fn(async (f: File) => file(`small-${f.name}`));

    const outcome = await requestDetection([file("a.jpg"), file("b.jpg")], { prepare, send });

    expect(outcome).toEqual({ ok: true, data: success });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/detect");
    expect(init.method).toBe("POST");
    const sent = (init.body as FormData).getAll("photo") as File[];
    expect(sent.map((f) => f.name)).toEqual(["small-a.jpg", "small-b.jpg"]); // the shrunk ones
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  describe("when the server reports a problem", () => {
    it.each([
      ["invalid_answer", true],
      ["ai_unavailable", true],
      ["limit_reached", false],
      ["invalid_photo", false],
      ["photo_too_large", false],
      ["server_misconfigured", false],
    ] as const)("passes on the message and the call count for %s (can try again: %s)", async (code, retryable) => {
      const send = reply(failureBody(code, "Shown to the user."), 503);

      const outcome = await requestDetection([file("a.jpg")], { prepare: async (f) => f, send });

      expect(outcome).toEqual({
        ok: false,
        failure: { code, message: "Shown to the user.", retryable, calls: { used: 2, limit: 10 } },
      });
    });
  });

  describe("when something goes wrong on the way", () => {
    const prepare = async (f: File) => f;

    it("says the server could not be reached when there is no network", async () => {
      const send = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      const outcome = await requestDetection([file("a.jpg")], { prepare, send });

      expect(outcome).toEqual({
        ok: false,
        failure: {
          code: "network",
          message: "We could not reach the server. Check your internet connection and try again.",
          retryable: true,
        },
      });
    });

    it("says it is taking too long when the request times out", async () => {
      const send = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));

      const outcome = await requestDetection([file("a.jpg")], { prepare, send });

      expect(outcome).toMatchObject({
        ok: false,
        failure: { code: "network", message: "This is taking longer than expected. Please try again.", retryable: true },
      });
    });

    it("gives a plain message when the reply is not what the server sends", async () => {
      const send = async () => new Response("<html>Bad gateway</html>", { status: 502 });

      const outcome = await requestDetection([file("a.jpg")], { prepare, send });

      expect(outcome).toEqual({
        ok: false,
        failure: {
          code: "ai_unavailable",
          message: "Something went wrong on our side. Please try again.",
          retryable: true,
        },
      });
    });

    it("does not trust a successful reply that has no furniture list", async () => {
      const outcome = await requestDetection([file("a.jpg")], { prepare, send: reply({ hello: "world" }) });

      expect(outcome.ok).toBe(false);
    });

    it("names a photo that cannot be read and sends nothing", async () => {
      const send = vi.fn(reply(success));
      const prepare = vi.fn(async (f: File) => {
        if (f.name === "broken.png") throw new Error("not an image");
        return f;
      });

      const outcome = await requestDetection([file("a.jpg"), file("broken.png")], { prepare, send });

      expect(outcome).toEqual({
        ok: false,
        failure: {
          code: "unreadable_photo",
          message: '"broken.png" could not be read as a photo. Remove it and try again.',
          retryable: false,
        },
      });
      expect(send).not.toHaveBeenCalled();
    });
  });
});
