import { DataUtils, EquirectangularReflectionMapping, HalfFloatType } from "three";
import { describe, expect, it } from "vitest";
import { reflections } from "./reflections";
import { createRoomScene } from "./room-scene";

/** The light that the picture has at a place in it, as parts of its width, round the room, and of its height, up from straight down. */
function lightAt(around: number, up: number) {
  const { width, height, data } = reflections().image as { width: number; height: number; data: Uint16Array };
  const column = Math.min(width - 1, Math.floor(around * width));
  const row = Math.min(height - 1, Math.floor(up * height));
  return DataUtils.fromHalfFloat(data[(row * width + column) * 4]);
}

describe("the picture that the shiny furniture reflects", () => {
  it("is a picture of all directions, kept once and used for every piece in every room", () => {
    const picture = reflections();

    expect(picture).toBe(reflections());
    expect(picture.mapping).toBe(EquirectangularReflectionMapping);
    expect(picture.type).toBe(HalfFloatType);
    expect(picture.image.width).toBe(2 * picture.image.height);
  });

  it("has light everywhere, never an unlit or a broken spot", () => {
    const { width, height, data } = reflections().image as { width: number; height: number; data: Uint16Array };

    for (let pixel = 0; pixel < width * height; pixel++) {
      for (const channel of [0, 1, 2]) {
        const light = DataUtils.fromHalfFloat(data[pixel * 4 + channel]);
        expect(light, `pixel ${pixel}`).toBeGreaterThan(0.02);
        expect(Number.isFinite(light), `pixel ${pixel}`).toBe(true);
      }
      expect(DataUtils.fromHalfFloat(data[pixel * 4 + 3])).toBe(1);
    }
  });

  it("is darker below than at the horizon, and lighter above, as the inside of a room is", () => {
    const below = lightAt(0.1, 0.1);
    const horizon = lightAt(0.1, 0.5);
    const above = lightAt(0.1, 0.95);

    expect(below).toBeLessThan(horizon);
    expect(horizon).toBeLessThan(above);
  });

  it("is the same all round, away from the windows", () => {
    expect(lightAt(0.05, 0.4)).toBeCloseTo(lightAt(0.6, 0.4), 3);
    expect(lightAt(0.15, 0.9)).toBeCloseTo(lightAt(0.55, 0.9), 3);
  });

  it("has a big window on the side that the light of the room comes from, far brighter than the walls", () => {
    // Where the light of the room is, as the picture gives directions: round the room, and up from straight down.
    const sun = createRoomScene({ width_m: 4, length_m: 4, height_m: 2.5 }).getObjectByName("side-light")!.position.clone().normalize();
    const around = Math.atan2(sun.z, sun.x) / (2 * Math.PI) + 0.5;
    const up = Math.asin(sun.y) / Math.PI + 0.5;

    expect(lightAt(around, up)).toBeGreaterThan(5 * lightAt(around, 0.5));
  });

  it("has a smaller window on the other side, which is bright but not as bright", () => {
    const small = lightAt(0.35, 0.72);

    expect(small).toBeGreaterThan(5 * lightAt(0.35, 0.5));
    expect(small).toBeLessThan(lightAt(0.84, 0.79));
  });
});
