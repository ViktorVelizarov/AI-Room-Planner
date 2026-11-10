import type { RoomSize } from "./room";

/**
 * A piece of furniture seen from above: where it stands, how big it is and which way it faces. It
 * is a rectangle on the floor, turned about the vertical axis. All the checks that a layout has to
 * pass (no piece in another, no piece through a wall) are made on these rectangles.
 */
export type Footprint = {
  /** The middle of the footprint, in metres from the middle of the floor: x across the room, z along its length. */
  x_m: number;
  z_m: number;
  /** The size in metres, in the piece's own directions: the width across its front, the depth from front to back. */
  width_m: number;
  depth_m: number;
  /**
   * Degrees about the vertical axis. 0 faces the front of the room (+z), and a positive angle turns the
   * front towards +x, which is what `rotation.y` does to an object in Three.js.
   */
  rotation_deg: number;
};

export type Point = { x: number; z: number };

/** How far apart, or how deep into each other, two footprints must be to count: below this they only touch. */
const EPSILON = 1e-9;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** The direction of the piece's own width (x) and depth (z) on the floor, for a rotation. */
function directions({ rotation_deg }: Footprint): { across: Point; along: Point } {
  const cos = Math.cos(radians(rotation_deg));
  const sin = Math.sin(radians(rotation_deg));
  return { across: { x: cos, z: -sin }, along: { x: sin, z: cos } };
}

/** The four corners of a footprint, going round it: back left, back right, front right, front left, with the area positive in x and z. */
export function footprintCorners(footprint: Footprint): [Point, Point, Point, Point] {
  const { across, along } = directions(footprint);
  const half = { across: footprint.width_m / 2, along: footprint.depth_m / 2 };
  const corner = (a: number, b: number): Point => ({
    x: footprint.x_m + a * half.across * across.x + b * half.along * along.x,
    z: footprint.z_m + a * half.across * across.z + b * half.along * along.z,
  });
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

/** The smallest box with sides along x and z that holds a footprint. */
export function footprintBounds(footprint: Footprint) {
  const corners = footprintCorners(footprint);
  const xs = corners.map((corner) => corner.x);
  const zs = corners.map((corner) => corner.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** The footprint made bigger by `margin` all round, so that two of them that touch are `2 * margin` apart. */
function grown(footprint: Footprint, margin: number): Footprint {
  return { ...footprint, width_m: footprint.width_m + 2 * margin, depth_m: footprint.depth_m + 2 * margin };
}

/** What two overlapping footprints need to be pushed apart: how far, and the direction that takes `a` to `b`. */
export type Overlap = { depth: number; x: number; z: number };

/**
 * How deep two footprints are in each other and along which direction the shortest push apart
 * goes, from `a` towards `b`; `null` if they are apart or only touch. With a `gap`, footprints that
 * are closer than the gap to each other count as overlapping, as if each piece were half a gap bigger.
 */
export function overlap(a: Footprint, b: Footprint, gap = 0): Overlap | null {
  const first = gap > 0 ? grown(a, gap / 2) : a;
  const second = gap > 0 ? grown(b, gap / 2) : b;
  const mine = directions(first);
  const yours = directions(second);
  const between = { x: second.x_m - first.x_m, z: second.z_m - first.z_m };

  let best: Overlap | null = null;
  // Two rectangles are apart if some side of either can be put between them (the separating axis test).
  for (const axis of [mine.across, mine.along, yours.across, yours.along]) {
    const reach = (footprint: Footprint, own: ReturnType<typeof directions>) =>
      (footprint.width_m / 2) * Math.abs(axis.x * own.across.x + axis.z * own.across.z) +
      (footprint.depth_m / 2) * Math.abs(axis.x * own.along.x + axis.z * own.along.z);
    const distance = between.x * axis.x + between.z * axis.z;
    const depth = reach(first, mine) + reach(second, yours) - Math.abs(distance);
    if (depth <= EPSILON) return null;
    if (!best || depth < best.depth) {
      const sign = distance < 0 ? -1 : 1;
      best = { depth, x: axis.x * sign, z: axis.z * sign };
    }
  }
  return best;
}

/** The area, in square metres, that two footprints have in common. */
export function overlapArea(a: Footprint, b: Footprint): number {
  const area = (polygon: Point[]) => {
    let sum = 0;
    polygon.forEach((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      sum += point.x * next.z - next.x * point.z;
    });
    return sum / 2;
  };
  // Cutting one rectangle with the four sides of the other (Sutherland-Hodgman). The corners of a footprint always go round the same way, whatever its turn, and the inside is on the left of each side.
  const clip = footprintCorners(b);
  let shape: Point[] = footprintCorners(a);
  clip.forEach((from, index) => {
    const to = clip[(index + 1) % clip.length];
    const side = (point: Point) => (to.x - from.x) * (point.z - from.z) - (to.z - from.z) * (point.x - from.x);
    const input = shape;
    shape = [];
    input.forEach((current, i) => {
      const previous = input[(i + input.length - 1) % input.length];
      const [now, before] = [side(current), side(previous)];
      if ((now >= 0) !== (before >= 0)) {
        const t = before / (before - now);
        shape.push({ x: previous.x + t * (current.x - previous.x), z: previous.z + t * (current.z - previous.z) });
      }
      if (now >= 0) shape.push(current);
    });
  });
  return Math.abs(area(shape));
}

/**
 * How far a footprint sticks out of the room, in metres: 0 if it is inside. With a `wallGap` the
 * walls count as that much further in.
 */
export function outsideRoom(footprint: Footprint, room: Pick<RoomSize, "width_m" | "length_m">, wallGap = 0): number {
  const { minX, maxX, minZ, maxZ } = footprintBounds(footprint);
  const halfWidth = room.width_m / 2 - wallGap;
  const halfLength = room.length_m / 2 - wallGap;
  const out = Math.max(-halfWidth - minX, maxX - halfWidth, -halfLength - minZ, maxZ - halfLength);
  return out > EPSILON ? out : 0;
}
