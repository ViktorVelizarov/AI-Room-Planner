import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CallLimitError,
  DEFAULT_CALL_LIMIT,
  callsCookie,
  getCallLimit,
  limitCalls,
  readCalls,
} from "./call-limit";

const requestWithCookie = (cookie?: string) =>
  new Request("http://localhost/api/detect", {
    method: "POST",
    headers: cookie === undefined ? {} : { cookie },
  });

describe("getCallLimit", () => {
  it.each([
    [undefined, DEFAULT_CALL_LIMIT],
    ["", DEFAULT_CALL_LIMIT],
    ["  ", DEFAULT_CALL_LIMIT],
    ["5", 5],
    [" 20 ", 20],
    ["0", 0], // a deliberate way to switch AI calls off
    ["-1", DEFAULT_CALL_LIMIT],
    ["2.5", DEFAULT_CALL_LIMIT],
    ["ten", DEFAULT_CALL_LIMIT],
  ])("reads %j as %j", (value, expected) => {
    expect(getCallLimit(value)).toBe(expected);
  });

  it("defaults to 10 calls", () => {
    expect(DEFAULT_CALL_LIMIT).toBe(10);
  });
});

describe("readCalls", () => {
  it.each([
    ["no cookie header", undefined, 0],
    ["no ai_calls cookie", "theme=dark", 0],
    ["the count", "ai_calls=3", 3],
    ["the count among other cookies", "a=b; ai_calls=7; c=d", 7],
    ["a count with leading zeros", "ai_calls=007", 7],
    ["text instead of a count", "ai_calls=lots", 0],
    ["a negative count", "ai_calls=-2", 0],
    ["a cookie that only ends in the name", "x_ai_calls=5", 0],
  ])("reads %s", (_name, cookie, used) => {
    expect(readCalls(requestWithCookie(cookie), 10)).toEqual({ used, limit: 10 });
  });
});

describe("callsCookie", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the count out of reach of page scripts, for the browser session", () => {
    const cookie = callsCookie({ used: 4, limit: 10 });
    expect(cookie).toContain("ai_calls=4");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api");
    expect(cookie).not.toMatch(/Max-Age|Expires/); // ends with the browser session
  });

  it("adds Secure in production only", () => {
    expect(callsCookie({ used: 1, limit: 10 })).not.toContain("Secure");
    vi.stubEnv("NODE_ENV", "production");
    expect(callsCookie({ used: 1, limit: 10 })).toContain("Secure");
  });
});

describe("limitCalls", () => {
  it("counts each call and passes the arguments and result through", async () => {
    const calls = { used: 0, limit: 3 };
    const call = vi.fn(async (a: number, b: number) => a + b);
    const limited = limitCalls(call, calls);

    await expect(limited(1, 2)).resolves.toBe(3);
    await limited(3, 4);

    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith(3, 4);
    expect(calls.used).toBe(2);
  });

  it("never sends a call once the limit is reached", async () => {
    const calls = { used: 1, limit: 2 };
    const call = vi.fn(async () => "ok");
    const limited = limitCalls(call, calls);

    await limited(); // the last one allowed
    const error = await limited().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CallLimitError);
    expect((error as CallLimitError).calls).toEqual({ used: 2, limit: 2 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(calls.used).toBe(2); // a blocked call is not counted
  });

  it("counts a call that fails", async () => {
    const calls = { used: 0, limit: 5 };
    const limited = limitCalls(async () => {
      throw new Error("network down");
    }, calls);

    await expect(limited()).rejects.toThrow("network down");
    expect(calls.used).toBe(1);
  });

  it("blocks everything when the limit is 0", async () => {
    const call = vi.fn(async () => "ok");

    await expect(limitCalls(call, { used: 0, limit: 0 })()).rejects.toBeInstanceOf(
      CallLimitError,
    );
    expect(call).not.toHaveBeenCalled();
  });
});
