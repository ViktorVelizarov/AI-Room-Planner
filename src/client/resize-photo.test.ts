import { describe, expect, it } from "vitest";
import { MAX_PHOTO_SIDE, fitWithin } from "./resize-photo";

describe("fitWithin", () => {
  it("shrinks a landscape photo so its longest side is 1568 px", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1568, height: 1176 });
  });

  it("shrinks a portrait photo the same way", () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: 1568 });
  });

  it("never enlarges a photo that is already small", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_PHOTO_SIDE, 1000)).toEqual({ width: MAX_PHOTO_SIDE, height: 1000 });
  });

  it("keeps the proportions and never produces a side of 0", () => {
    expect(fitWithin(100000, 10)).toEqual({ width: 1568, height: 1 });
  });

  it("can fit another size", () => {
    expect(fitWithin(2000, 1000, 500)).toEqual({ width: 500, height: 250 });
  });
});
