import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
} from "three";

/**
 * What the shiny pieces of furniture reflect. The lights of the room only make a surface lighter or
 * darker, so a metal or leather piece in them would look like a matt one, or like a dark one. This is
 * a picture of a bright room, seen from the middle in every direction: dim below, lighter above, with
 * a big window on the side that the light of the room comes from and a smaller one on the other. The
 * windows are what show up as a glint on a shiny surface; the rest is what makes a metal look like one.
 */

const WIDTH = 64;
const HEIGHT = 32;

/** How much light comes from below the horizon, from the horizon and from straight above. */
const GROUND = 0.04;
const HORIZON = 0.12;
const CEILING = 0.25;

/**
 * Bright patches in the picture. Their edges are parts of its width, counted round the room from the
 * direction of -x, and of its height, counted up from straight down.
 */
const WINDOWS = [
  { left: 0.78, right: 0.9, bottom: 0.7, top: 0.88, light: 6 },
  { left: 0.3, right: 0.4, bottom: 0.65, top: 0.8, light: 3 },
];

let picture: DataTexture | undefined;

/** The picture, made the first time and kept, for every piece in every room. */
export function reflections(): DataTexture {
  if (picture) return picture;
  const data = new Uint16Array(WIDTH * HEIGHT * 4);
  for (let row = 0; row < HEIGHT; row++) {
    // The first row is the bottom of the picture, straight down, and the last is straight up.
    const up = (row + 0.5) / HEIGHT;
    const sky = up < 0.5 ? GROUND + (HORIZON - GROUND) * (up / 0.5) : HORIZON + (CEILING - HORIZON) * ((up - 0.5) / 0.5);
    for (let column = 0; column < WIDTH; column++) {
      const around = (column + 0.5) / WIDTH;
      const patch = WINDOWS.find((w) => around > w.left && around < w.right && up > w.bottom && up < w.top);
      const light = DataUtils.toHalfFloat(patch ? patch.light : sky);
      data.set([light, light, light, DataUtils.toHalfFloat(1)], (row * WIDTH + column) * 4);
    }
  }
  picture = new DataTexture(data, WIDTH, HEIGHT, RGBAFormat, HalfFloatType);
  picture.mapping = EquirectangularReflectionMapping;
  picture.colorSpace = LinearSRGBColorSpace;
  picture.magFilter = LinearFilter;
  picture.minFilter = LinearFilter;
  picture.needsUpdate = true;
  return picture;
}
