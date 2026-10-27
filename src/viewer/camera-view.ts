import { MathUtils, Spherical, Vector3 } from "three";
import type { RoomSize } from "../shared/room";

/** Vertical field of view of the camera, in degrees. */
export const FIELD_OF_VIEW = 45;

/** The closest the camera may come to the point it looks at, in metres. */
export const MIN_DISTANCE = 1;

/** How much farther than the starting distance the camera may go, so the room cannot be lost. */
const MAX_DISTANCE_FACTOR = 2.5;

/** Where the camera is and the point it looks at, in metres. */
export type CameraView = { position: Vector3; target: Vector3 };

/**
 * One step of camera movement, as the keyboard makes it. Turning goes the way a drag in that
 * direction goes (dragging up shows the room from lower down), zooming is scrolling, and moving
 * shifts the view sideways or up and down, as dragging with the right button does.
 */
export type CameraMove =
  | "turn-left"
  | "turn-right"
  | "turn-up"
  | "turn-down"
  | "zoom-in"
  | "zoom-out"
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down";

const UP = new Vector3(0, 1, 0);

// The camera starts in front of the room (the side where z is largest), a little to the right
// and well above the floor, so it looks into the room over the near walls.
const START_AZIMUTH = MathUtils.degToRad(30);
const START_ELEVATION = MathUtils.degToRad(35);
const START_DIRECTION = new Vector3(
  Math.cos(START_ELEVATION) * Math.sin(START_AZIMUTH),
  Math.sin(START_ELEVATION),
  Math.cos(START_ELEVATION) * Math.cos(START_AZIMUTH),
);

// How much of the frame the room may fill at most: the rest is a margin.
const FILL = 0.92;

const TURN_STEP = MathUtils.degToRad(10);
const ZOOM_STEP = 1.2;
// A move is this fraction of the distance to the point the camera looks at.
const MOVE_STEP = 0.1;

const safeAspect = (aspect: number) => (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);

/**
 * The view the camera starts in and returns to on Reset: it looks at the middle of the room from
 * far enough away that the whole room is in the frame, whatever the room's shape and the shape of
 * the frame (`aspect` is its width divided by its height).
 */
export function defaultView(room: RoomSize, aspect: number): CameraView {
  const { width_m, length_m, height_m } = room;
  const halfWidth = width_m / 2;
  const halfLength = length_m / 2;
  // The room is centred on the origin (see room-scene.ts), so its middle is halfway up the axis.
  const target = new Vector3(0, height_m / 2, 0);

  // The camera looks along `forward`, with `right` and `up` across the frame.
  const forward = START_DIRECTION.clone().negate();
  const right = new Vector3().crossVectors(forward, UP).normalize();
  const up = new Vector3().crossVectors(right, forward);
  const tanVertical = Math.tan(MathUtils.degToRad(FIELD_OF_VIEW) / 2);
  const tanHorizontal = tanVertical * safeAspect(aspect);

  // A corner that lies `across` to the side and `beyond` the target is in the frame when
  // across <= (distance + beyond) * tan * FILL. Take the distance that every corner needs.
  let distance = 0;
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [0, height_m]) {
      for (const z of [-halfLength, halfLength]) {
        const corner = new Vector3(x, y, z).sub(target);
        const beyond = corner.dot(forward);
        const needed = Math.max(
          Math.abs(corner.dot(right)) / (tanHorizontal * FILL),
          Math.abs(corner.dot(up)) / (tanVertical * FILL),
        );
        distance = Math.max(distance, needed - beyond);
      }
    }
  }

  return { target, position: target.clone().addScaledVector(START_DIRECTION, distance) };
}

/** How near and how far the camera may be from the point it looks at. */
export function distanceLimits(room: RoomSize, aspect: number): { min: number; max: number } {
  const { position, target } = defaultView(room, aspect);
  return { min: MIN_DISTANCE, max: position.distanceTo(target) * MAX_DISTANCE_FACTOR };
}

/** The point the camera looks at, held inside the room, so moving the view cannot lose the room. */
export function clampTarget(target: Vector3, room: RoomSize): Vector3 {
  const halfWidth = room.width_m / 2;
  const halfLength = room.length_m / 2;
  return new Vector3(
    MathUtils.clamp(target.x, -halfWidth, halfWidth),
    MathUtils.clamp(target.y, 0, room.height_m),
    MathUtils.clamp(target.z, -halfLength, halfLength),
  );
}

/** The view after one step of movement. Limits such as the nearest distance are applied by the viewer. */
export function moveView(view: CameraView, move: CameraMove): CameraView {
  const offset = view.position.clone().sub(view.target);
  const target = view.target.clone();

  switch (move) {
    case "turn-left":
    case "turn-right":
    case "turn-up":
    case "turn-down": {
      const spherical = new Spherical().setFromVector3(offset);
      if (move === "turn-left") spherical.theta += TURN_STEP;
      if (move === "turn-right") spherical.theta -= TURN_STEP;
      if (move === "turn-up") spherical.phi += TURN_STEP;
      if (move === "turn-down") spherical.phi -= TURN_STEP;
      spherical.makeSafe();
      offset.setFromSpherical(spherical);
      break;
    }
    case "zoom-in":
      offset.divideScalar(ZOOM_STEP);
      break;
    case "zoom-out":
      offset.multiplyScalar(ZOOM_STEP);
      break;
    case "move-left":
    case "move-right":
    case "move-up":
    case "move-down": {
      const forward = offset.clone().negate().normalize();
      const right = new Vector3().crossVectors(forward, UP).normalize();
      const up = new Vector3().crossVectors(right, forward);
      const step = offset.length() * MOVE_STEP;
      if (move === "move-left") target.addScaledVector(right, -step);
      if (move === "move-right") target.addScaledVector(right, step);
      if (move === "move-up") target.addScaledVector(up, step);
      if (move === "move-down") target.addScaledVector(up, -step);
      break;
    }
  }

  return { target, position: target.clone().add(offset) };
}
