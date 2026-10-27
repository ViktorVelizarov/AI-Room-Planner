import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { RoomSize } from "../shared/room";
import {
  FIELD_OF_VIEW,
  MIN_DISTANCE,
  clampTarget,
  defaultView,
  distanceLimits,
  moveView,
  type CameraMove,
  type CameraView,
} from "./camera-view";

const room: RoomSize = { width_m: 6, length_m: 4.5, height_m: 2.5 };

// The smallest and largest rooms the size form accepts, long and narrow ones, and a typical one.
const ROOMS: RoomSize[] = [
  room,
  { width_m: 4, length_m: 5, height_m: 2.5 },
  { width_m: 1, length_m: 1, height_m: 2 },
  { width_m: 20, length_m: 20, height_m: 5 },
  { width_m: 1, length_m: 20, height_m: 2 },
  { width_m: 20, length_m: 1, height_m: 5 },
];

// Wide screens, a square, and the tall frame of a phone.
const ASPECTS = [16 / 9, 4 / 3, 1, 0.5, 0.3];

const cameraAt = (view: CameraView, aspect = 1) => {
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, aspect, 0.1, 1000);
  camera.position.copy(view.position);
  camera.lookAt(view.target);
  camera.updateMatrixWorld();
  return camera;
};

/** The room's eight corners as this camera sees them: -1 to 1 across and up the frame, in front of it in depth. */
const cornersInFrame = (size: RoomSize, view: CameraView, aspect: number) => {
  const camera = cameraAt(view, aspect);
  const corners: Vector3[] = [];
  for (const x of [-size.width_m / 2, size.width_m / 2]) {
    for (const y of [0, size.height_m]) {
      for (const z of [-size.length_m / 2, size.length_m / 2]) corners.push(new Vector3(x, y, z).project(camera));
    }
  }
  return corners;
};

const distanceOf = (view: CameraView) => view.position.distanceTo(view.target);

/** The directions across and up the frame, as the camera of this view has them. */
const axesOf = (view: CameraView) => {
  const camera = cameraAt(view);
  return {
    right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
  };
};

const sphericalOf = (view: CameraView) => new Spherical().setFromVector3(view.position.clone().sub(view.target));

describe("defaultView", () => {
  it("looks at the middle of the room, which is halfway up above the middle of the floor", () => {
    expect(defaultView(room, 1.5).target.toArray()).toEqual([0, 1.25, 0]);
    for (const size of ROOMS) {
      expect(defaultView(size, 1.5).target.toArray(), JSON.stringify(size)).toEqual([0, size.height_m / 2, 0]);
    }
  });

  it("puts the middle of the room in the middle of the frame, so the room is centred in what the user sees", () => {
    for (const size of ROOMS) {
      for (const aspect of ASPECTS) {
        const view = defaultView(size, aspect);
        const middle = new Vector3(0, size.height_m / 2, 0).project(cameraAt(view, aspect));

        expect(middle.x, `${JSON.stringify(size)} at aspect ${aspect}`).toBeCloseTo(0, 6);
        expect(middle.y, `${JSON.stringify(size)} at aspect ${aspect}`).toBeCloseTo(0, 6);
      }
    }
  });

  it("has the whole room in the frame, for every room size and every shape of frame", () => {
    for (const size of ROOMS) {
      for (const aspect of ASPECTS) {
        const view = defaultView(size, aspect);
        for (const corner of cornersInFrame(size, view, aspect)) {
          const where = `${JSON.stringify(size)} at aspect ${aspect}`;
          expect(Math.abs(corner.x), where).toBeLessThanOrEqual(1);
          expect(Math.abs(corner.y), where).toBeLessThanOrEqual(1);
          expect(Math.abs(corner.z), where).toBeLessThan(1);
        }
      }
    }
  });

  it("fills the frame without wasting it: the room comes within a small margin of the edge", () => {
    for (const size of ROOMS) {
      for (const aspect of ASPECTS) {
        const corners = cornersInFrame(size, defaultView(size, aspect), aspect);
        const widest = Math.max(...corners.flatMap((corner) => [Math.abs(corner.x), Math.abs(corner.y)]));
        expect(widest, `${JSON.stringify(size)} at aspect ${aspect}`).toBeCloseTo(0.92, 5);
      }
    }
  });

  it("looks into the room from the front and the right, above the walls", () => {
    for (const size of ROOMS) {
      const { position, target } = defaultView(size, 1.5);
      expect(position.y).toBeGreaterThan(size.height_m);
      expect(position.x).toBeGreaterThan(target.x);
      expect(position.z).toBeGreaterThan(target.z);
    }
  });

  it("stays farther away for a narrower frame, and for a bigger room", () => {
    expect(distanceOf(defaultView(room, 0.5))).toBeGreaterThan(distanceOf(defaultView(room, 2)));
    const big = { width_m: 20, length_m: 20, height_m: 5 };
    expect(distanceOf(defaultView(big, 1.5))).toBeGreaterThan(distanceOf(defaultView(room, 1.5)));
  });

  it("treats a frame without a usable shape as square", () => {
    for (const aspect of [0, -2, NaN, Infinity]) {
      expect(defaultView(room, aspect).position.toArray()).toEqual(defaultView(room, 1).position.toArray());
    }
  });

  it("is the same every time, so that Reset returns to exactly the starting view", () => {
    expect(defaultView(room, 1.5).position.toArray()).toEqual(defaultView(room, 1.5).position.toArray());
  });
});

describe("distanceLimits", () => {
  it("lets the camera start well inside its limits", () => {
    for (const size of ROOMS) {
      for (const aspect of ASPECTS) {
        const start = distanceOf(defaultView(size, aspect));
        const { min, max } = distanceLimits(size, aspect);
        expect(min).toBe(MIN_DISTANCE);
        expect(start).toBeGreaterThan(min);
        expect(max).toBeGreaterThan(start);
      }
    }
  });

  it("lets the camera go back far enough to see the room from a distance, but not so far that it is lost", () => {
    const start = distanceOf(defaultView(room, 1.5));
    expect(distanceLimits(room, 1.5).max / start).toBeCloseTo(2.5, 5);
  });
});

describe("clampTarget", () => {
  // The 6 x 4.5 x 2.5 m room reaches from -3 to 3 in x, 0 to 2.5 in y and -2.25 to 2.25 in z.
  it("leaves a point inside the room alone, including the middle of the floor and each corner", () => {
    expect(clampTarget(new Vector3(1, 2, 1.5), room).toArray()).toEqual([1, 2, 1.5]);
    expect(clampTarget(new Vector3(0, 0, 0), room).toArray()).toEqual([0, 0, 0]);
    expect(clampTarget(new Vector3(-3, 0, -2.25), room).toArray()).toEqual([-3, 0, -2.25]);
    expect(clampTarget(new Vector3(3, 2.5, 2.25), room).toArray()).toEqual([3, 2.5, 2.25]);
  });

  it("brings a point outside the room back to the nearest point of it, one side at a time", () => {
    expect(clampTarget(new Vector3(-10, 10, 99), room).toArray()).toEqual([-3, 2.5, 2.25]);
    expect(clampTarget(new Vector3(50, -3, -9), room).toArray()).toEqual([3, 0, -2.25]);
    expect(clampTarget(new Vector3(1, 1, 99), room).toArray()).toEqual([1, 1, 2.25]);
    expect(clampTarget(new Vector3(-99, 1, 1), room).toArray()).toEqual([-3, 1, 1]);
  });

  it("holds a point in a room of any size to half the width and half the length from the middle", () => {
    for (const size of ROOMS) {
      const far = clampTarget(new Vector3(1000, 1000, 1000), size);
      const near = clampTarget(new Vector3(-1000, -1000, -1000), size);

      expect(far.toArray(), JSON.stringify(size)).toEqual([size.width_m / 2, size.height_m, size.length_m / 2]);
      expect(near.toArray(), JSON.stringify(size)).toEqual([-size.width_m / 2, 0, -size.length_m / 2]);
    }
  });

  it("returns a new point and does not change the one it was given", () => {
    const given = new Vector3(-1, 10, 99);
    const clamped = clampTarget(given, room);

    expect(clamped).not.toBe(given);
    expect(given.toArray()).toEqual([-1, 10, 99]);
  });
});

describe("moveView", () => {
  const start = defaultView(room, 1.5);
  const TEN_DEGREES = MathUtils.degToRad(10);

  /** How the camera itself moved, across and up the frame of the view it started from. */
  const cameraShift = (move: CameraMove) => {
    const after = moveView(start, move);
    const shift = after.position.clone().sub(start.position);
    const { right, up } = axesOf(start);
    return { across: shift.dot(right), up: shift.dot(up), after };
  };

  it("turns the room the way a drag in that direction does: the camera goes the other way", () => {
    // Dragging right turns the room to the right, so the camera moves left; dragging down shows it from higher up.
    expect(cameraShift("turn-right").across).toBeLessThan(0);
    expect(cameraShift("turn-left").across).toBeGreaterThan(0);
    expect(cameraShift("turn-down").up).toBeGreaterThan(0);
    expect(cameraShift("turn-up").up).toBeLessThan(0);
  });

  it("turns by ten degrees around the point it looks at, without changing the distance or the other angle", () => {
    const before = sphericalOf(start);
    const turns: [CameraMove, "theta" | "phi", number][] = [
      ["turn-left", "theta", TEN_DEGREES],
      ["turn-right", "theta", -TEN_DEGREES],
      ["turn-up", "phi", TEN_DEGREES],
      ["turn-down", "phi", -TEN_DEGREES],
    ];

    for (const [move, angle, change] of turns) {
      const after = sphericalOf(moveView(start, move));
      const other = angle === "theta" ? "phi" : "theta";
      expect(after[angle] - before[angle], move).toBeCloseTo(change, 6);
      expect(after[other], move).toBeCloseTo(before[other], 6);
      expect(after.radius, move).toBeCloseTo(before.radius, 6);
      expect(moveView(start, move).target.toArray(), move).toEqual(start.target.toArray());
    }
  });

  it("cannot turn over the top: keeps turning down and stays a little short of straight above", () => {
    let view = start;
    for (let i = 0; i < 30; i++) view = moveView(view, "turn-down");

    const { phi, radius } = sphericalOf(view);
    expect(phi).toBeGreaterThan(0);
    expect(phi).toBeLessThan(0.01);
    expect(radius).toBeCloseTo(distanceOf(start), 6);
    expect(view.position.toArray().every(Number.isFinite)).toBe(true);
  });

  it("zooms by moving along the line of sight: nearer for in, farther for out, the point looked at unchanged", () => {
    const zoomedIn = moveView(start, "zoom-in");
    const zoomedOut = moveView(start, "zoom-out");

    expect(distanceOf(zoomedIn)).toBeCloseTo(distanceOf(start) / 1.2, 6);
    expect(distanceOf(zoomedOut)).toBeCloseTo(distanceOf(start) * 1.2, 6);
    expect(zoomedIn.target.toArray()).toEqual(start.target.toArray());
    const direction = (view: CameraView) => view.position.clone().sub(view.target).normalize();
    expect(direction(zoomedIn).distanceTo(direction(start))).toBeCloseTo(0, 6);
  });

  it("returns to where it was after zooming in and out", () => {
    const back = moveView(moveView(start, "zoom-in"), "zoom-out");
    expect(back.position.distanceTo(start.position)).toBeCloseTo(0, 6);
  });

  it("moves the view across and up the frame, by a tenth of the distance, without turning it", () => {
    const step = distanceOf(start) / 10;
    const moves: [CameraMove, number, number][] = [
      ["move-right", step, 0],
      ["move-left", -step, 0],
      ["move-up", 0, step],
      ["move-down", 0, -step],
    ];

    for (const [move, across, up] of moves) {
      const shift = cameraShift(move);
      expect(shift.across, move).toBeCloseTo(across, 6);
      expect(shift.up, move).toBeCloseTo(up, 6);
      // The camera and the point it looks at move together, so the direction and distance are unchanged.
      const targetShift = shift.after.target.clone().sub(start.target);
      expect(targetShift.distanceTo(shift.after.position.clone().sub(start.position)), move).toBeCloseTo(0, 6);
      expect(distanceOf(shift.after), move).toBeCloseTo(distanceOf(start), 6);
    }
  });

  it("does not change the view it was given", () => {
    const before = [start.position.toArray(), start.target.toArray()];
    for (const move of ["turn-left", "zoom-in", "move-up"] as CameraMove[]) moveView(start, move);
    expect([start.position.toArray(), start.target.toArray()]).toEqual(before);
  });
});
