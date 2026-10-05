import { describe, expect, it } from "vitest";
import { FURNITURE_LABELS, MATERIALS } from "../shared/furniture";
import { requestParts } from "./gemini";
import { buildDetectionPrompt } from "./prompt";
import type { DetectionImage } from "./types";

describe("buildDetectionPrompt", () => {
  it("lists every supported label and material", () => {
    const prompt = buildDetectionPrompt(1);

    for (const label of FURNITURE_LABELS) expect(prompt).toContain(label);
    for (const material of MATERIALS) expect(prompt).toContain(material);
  });

  it("does not mention several photos when there is one", () => {
    expect(buildDetectionPrompt(1)).not.toMatch(/photos of the same room/);
  });

  it("says the photos show one room and each piece is listed once, when there are several", () => {
    const prompt = buildDetectionPrompt(3);

    expect(prompt).toContain("You are given 3 photos of the same room");
    expect(prompt).toMatch(/list it only once/);
  });

  it("keeps the instructions on what to report after the note about several photos", () => {
    const prompt = buildDetectionPrompt(2);

    expect(prompt.indexOf("photos of the same room")).toBeLessThan(
      prompt.indexOf("Detect every piece of furniture"),
    );
  });
});

describe("requestParts", () => {
  const photo = (data: string): DetectionImage => ({ data, mimeType: "image/jpeg" });

  it("puts every photo first, in order, then the instructions", () => {
    const parts = requestParts([photo("AAA"), photo("BBB"), photo("CCC")]);

    expect(parts).toHaveLength(4);
    expect(parts.slice(0, 3)).toEqual([
      { inlineData: { data: "AAA", mimeType: "image/jpeg" } },
      { inlineData: { data: "BBB", mimeType: "image/jpeg" } },
      { inlineData: { data: "CCC", mimeType: "image/jpeg" } },
    ]);
    expect(parts[3]).toEqual({ text: buildDetectionPrompt(3) });
  });
});
