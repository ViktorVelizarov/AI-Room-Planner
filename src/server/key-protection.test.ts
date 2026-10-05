import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards for "the API key never reaches the browser" (US-09 AC1). Next.js blanks out
// environment variables without the NEXT_PUBLIC_ prefix in client code, so what could go
// wrong is a rename, or the key being read from yet another place.

/** Source files under src/ (not tests), as paths like "ai/gemini.ts". */
function sourceFiles(): string[] {
  return (readdirSync("src", { recursive: true }) as string[])
    .map((path) => path.split("\\").join("/"))
    .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path));
}

const read = (path: string) => readFileSync(join("src", path), "utf8");

describe("API key protection", () => {
  it("is read in exactly one module", () => {
    const readers = sourceFiles().filter((path) => read(path).includes("GEMINI_API_KEY"));

    expect(readers).toEqual(["ai/gemini.ts"]);
  });

  it("is never given a NEXT_PUBLIC_ name, which would put it in the browser bundle", () => {
    const withPublicSecret = [
      ...sourceFiles().map((path) => ({ path, text: read(path) })),
      { path: ".env.example", text: readFileSync(".env.example", "utf8") },
    ].filter(({ text }) => /NEXT_PUBLIC_\w*(KEY|SECRET|TOKEN)/i.test(text));

    expect(withPublicSecret.map(({ path }) => path)).toEqual([]);
  });

  it("is only reachable through the server modules that import `server-only`", () => {
    const handlers = sourceFiles().filter((path) => path.startsWith("server/"));

    expect(handlers.length).toBeGreaterThan(0);
    for (const path of handlers) {
      expect(read(path), `${path} should start by importing server-only`).toMatch(
        /^import "server-only";/,
      );
    }
  });
});
