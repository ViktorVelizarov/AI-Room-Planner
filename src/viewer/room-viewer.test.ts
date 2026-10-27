// @vitest-environment jsdom
import { Box3, type PerspectiveCamera, type Scene, Spherical, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomSize } from "../shared/room";
import { MIN_DISTANCE, defaultView, distanceLimits, type CameraView } from "./camera-view";
import { createRoomViewer, type RoomViewer } from "./room-viewer";

// jsdom has no WebGL, so the renderer is replaced by one that only records what it is asked to do.
// The camera controls are the real ones.
const fake = vi.hoisted(() => {
  const state = { works: true };

  class FakeRenderer {
    static instances: FakeRenderer[] = [];
    domElement = document.createElement("canvas");
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    forceContextLoss = vi.fn();

    constructor() {
      if (!state.works) throw new Error("Error creating WebGL context.");
      const canvas = this.domElement;
      // A real canvas has a size and can capture the pointer; the controls use both.
      Object.defineProperty(canvas, "clientHeight", { value: 400 });
      Object.defineProperty(canvas, "clientWidth", { value: 600 });
      Object.assign(canvas, {
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        hasPointerCapture: () => false,
      });
      FakeRenderer.instances.push(this);
    }
  }
  return { state, FakeRenderer };
});

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: fake.FakeRenderer,
}));

const room: RoomSize = { width_m: 6, length_m: 4.5, height_m: 2.5 };

// Frames are run by hand, so that what is drawn in each one can be counted.
let pending = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const flushFrames = () => {
  const run = [...pending.values()];
  pending.clear();
  run.forEach((callback) => callback(0));
};

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(private callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  trigger() {
    this.callback();
  }
}

const frame = { width: 600, height: 400 };
const live: RoomViewer[] = [];

beforeEach(() => {
  pending = new Map();
  nextFrame = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => void pending.delete(id));
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  live.splice(0).forEach((viewer) => viewer.dispose());
  document.body.innerHTML = "";
  fake.FakeRenderer.instances.length = 0;
  FakeResizeObserver.instances.length = 0;
  fake.state.works = true;
  frame.width = 600;
  frame.height = 400;
  vi.unstubAllGlobals();
});

/** A viewer in a container the size of `frame`, with the fake renderer it was given. */
function open(size: RoomSize = room) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { get: () => frame.width });
  Object.defineProperty(container, "clientHeight", { get: () => frame.height });
  document.body.append(container);

  const viewer = createRoomViewer(container, size);
  live.push(viewer);
  const renderer = fake.FakeRenderer.instances[fake.FakeRenderer.instances.length - 1];
  return { container, viewer, renderer, canvas: renderer.domElement };
}

/** A mouse or touch event of the kind the camera controls listen to. */
function pointer(
  canvas: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
  options: { button?: number; id?: number; touch?: boolean } = {},
) {
  const button = options.button ?? 0;
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
    buttons: type === "pointerup" ? 0 : [1, 4, 2][button],
  });
  Object.defineProperties(event, {
    pointerId: { value: options.id ?? 1 },
    pointerType: { value: options.touch ? "touch" : "mouse" },
    pageX: { value: x },
    pageY: { value: y },
  });
  canvas.dispatchEvent(event);
}

/** Presses at one place, moves to another and lets go. */
function drag(canvas: HTMLElement, from: [number, number], to: [number, number], button = 0) {
  pointer(canvas, "pointerdown", from[0], from[1], { button });
  pointer(canvas, "pointermove", to[0], to[1], { button });
  pointer(canvas, "pointerup", to[0], to[1], { button });
}

const scroll = (canvas: HTMLElement, deltaY: number) => {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  canvas.dispatchEvent(event);
  return event;
};

const distanceOf = (view: CameraView) => view.position.distanceTo(view.target);
const anglesOf = (view: CameraView) => new Spherical().setFromVector3(view.position.clone().sub(view.target));
const asArrays = (view: CameraView) => [view.position.toArray(), view.target.toArray()];

/** The camera's view against one worked out separately: the same, to within the rounding of the camera controls. */
function expectSameView(actual: CameraView, expected: CameraView) {
  for (const part of ["position", "target"] as const) {
    actual[part].toArray().forEach((value, axis) => expect(value, part).toBeCloseTo(expected[part].getComponent(axis), 6));
  }
}

/** The point is in the 6 x 4.5 x 2.5 m room: within half the width and half the length of the middle of the floor, and between floor and ceiling. */
function expectInsideRoom(point: Vector3, message: string) {
  const slack = 1e-6;
  expect(Math.abs(point.x), `${message}: x`).toBeLessThanOrEqual(3 + slack);
  expect(point.y, `${message}: y above the floor`).toBeGreaterThanOrEqual(-slack);
  expect(point.y, `${message}: y below the ceiling`).toBeLessThanOrEqual(2.5 + slack);
  expect(Math.abs(point.z), `${message}: z`).toBeLessThanOrEqual(2.25 + slack);
}

describe("createRoomViewer", () => {
  it("puts the picture in the container and hides it from screen readers (the container carries the label)", () => {
    const { container, canvas } = open();

    expect(container.contains(canvas)).toBe(true);
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
  });

  it("makes the picture as big as the container and draws the room of the size given", () => {
    const { renderer } = open();
    flushFrames();

    expect(renderer.setSize).toHaveBeenLastCalledWith(600, 400, false);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    const [scene] = renderer.render.mock.calls[0] as [Scene];
    const box = new Box3().setFromObject(scene.getObjectByName("room")!);
    // Rounded to centimetres; adding 0 turns a rounded -0 into 0.
    const rounded = (point: Vector3) => point.toArray().map((value) => Math.round(value * 100) / 100 + 0);
    expect(rounded(box.getSize(new Vector3()))).toEqual([6, 2.5, 4.5]);
    expect(rounded(box.getCenter(new Vector3()))).toEqual([0, 1.25, 0]);
  });

  it("starts at the view that fits the whole room in this container", () => {
    const { viewer } = open();

    expectSameView(viewer.getView(), defaultView(room, 600 / 400));
  });

  it("throws when the browser cannot make a graphics context, and leaves the page as it was", () => {
    fake.state.works = false;
    const container = document.createElement("div");
    document.body.append(container);

    expect(() => createRoomViewer(container, room)).toThrow("WebGL");
    expect(container.childElementCount).toBe(0);
  });
});

describe("drawing", () => {
  it("draws only when something has changed, not on every frame", () => {
    const { viewer, renderer } = open();
    flushFrames();
    flushFrames();
    flushFrames();
    expect(renderer.render).toHaveBeenCalledTimes(1);

    viewer.move("zoom-in");
    flushFrames();
    flushFrames();
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it("draws once for several changes that come before the next frame", () => {
    const { viewer, renderer } = open();
    flushFrames();

    viewer.move("zoom-in");
    viewer.move("turn-left");
    viewer.move("move-up");
    flushFrames();

    expect(renderer.render).toHaveBeenCalledTimes(2);
  });
});

describe("looking around the room", () => {
  it("turns the room around its middle when the user drags", () => {
    const { viewer, canvas } = open();
    const before = viewer.getView();

    drag(canvas, [300, 200], [400, 200]);

    const after = viewer.getView();
    expect(anglesOf(after).theta).toBeLessThan(anglesOf(before).theta);
    expect(anglesOf(after).phi).toBeCloseTo(anglesOf(before).phi, 6);
    expect(distanceOf(after)).toBeCloseTo(distanceOf(before), 6);
    expect(after.target.toArray()).toEqual(before.target.toArray());
  });

  it("shows the room from higher up when the user drags down, and from lower down when up", () => {
    const { viewer, canvas } = open();
    // phi is the angle from straight above: the smaller it is, the higher the camera.
    const phi = () => anglesOf(viewer.getView()).phi;
    const start = phi();

    drag(canvas, [300, 200], [300, 240]);
    const higher = phi();
    expect(higher).toBeLessThan(start);

    drag(canvas, [300, 240], [300, 140]);
    expect(phi()).toBeGreaterThan(higher);
  });

  it("zooms when the user scrolls, and the page does not scroll with it", () => {
    const { viewer, canvas } = open();
    const start = distanceOf(viewer.getView());

    const zoomIn = scroll(canvas, -100);
    const nearer = distanceOf(viewer.getView());
    const zoomOut = scroll(canvas, 100);
    const farther = distanceOf(viewer.getView());

    expect(nearer).toBeLessThan(start);
    expect(farther).toBeGreaterThan(nearer);
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(zoomOut.defaultPrevented).toBe(true);
  });

  it("moves the view, without turning it, when the user drags with the right button", () => {
    const { viewer, canvas } = open();
    const before = viewer.getView();

    drag(canvas, [300, 200], [340, 200], 2);

    const after = viewer.getView();
    expect(after.target.distanceTo(before.target)).toBeGreaterThan(0.01);
    expect(distanceOf(after)).toBeCloseTo(distanceOf(before), 6);
    expect(anglesOf(after).theta).toBeCloseTo(anglesOf(before).theta, 6);
    expect(anglesOf(after).phi).toBeCloseTo(anglesOf(before).phi, 6);
  });

  it("zooms when two fingers are spread apart, and out when they come together", () => {
    const { viewer, canvas } = open();
    const start = distanceOf(viewer.getView());

    pointer(canvas, "pointerdown", 250, 200, { id: 1, touch: true });
    pointer(canvas, "pointerdown", 350, 200, { id: 2, touch: true });
    pointer(canvas, "pointermove", 200, 200, { id: 1, touch: true });
    pointer(canvas, "pointermove", 400, 200, { id: 2, touch: true });
    const spread = distanceOf(viewer.getView());
    pointer(canvas, "pointerup", 200, 200, { id: 1, touch: true });
    pointer(canvas, "pointerup", 400, 200, { id: 2, touch: true });

    pointer(canvas, "pointerdown", 200, 200, { id: 3, touch: true });
    pointer(canvas, "pointerdown", 400, 200, { id: 4, touch: true });
    pointer(canvas, "pointermove", 280, 200, { id: 3, touch: true });
    pointer(canvas, "pointermove", 320, 200, { id: 4, touch: true });
    const pinched = distanceOf(viewer.getView());

    expect(spread).toBeLessThan(start);
    expect(pinched).toBeGreaterThan(spread);
  });

  it("turns the room when one finger is dragged", () => {
    const { viewer, canvas } = open();
    const before = anglesOf(viewer.getView()).theta;

    pointer(canvas, "pointerdown", 300, 200, { touch: true });
    pointer(canvas, "pointermove", 380, 200, { touch: true });
    pointer(canvas, "pointerup", 380, 200, { touch: true });

    expect(anglesOf(viewer.getView()).theta).toBeLessThan(before);
  });

  it("shows a hand over the room, closed while it is being dragged, so that it is clear it can be turned", () => {
    const { canvas } = open();
    expect(canvas.style.cursor).toBe("grab");

    pointer(canvas, "pointerdown", 300, 200);
    expect(canvas.style.cursor).toBe("grabbing");

    pointer(canvas, "pointerup", 300, 200);
    expect(canvas.style.cursor).toBe("grab");
  });

  it("moves in the steps the keyboard makes, and draws the result", () => {
    const { viewer, renderer } = open();
    flushFrames();
    const start = viewer.getView();

    viewer.move("zoom-in");
    flushFrames();

    expect(distanceOf(viewer.getView())).toBeCloseTo(distanceOf(start) / 1.2, 6);
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });
});

describe("limits", () => {
  it("does not let the camera come nearer than a metre, or go so far that the room is lost", () => {
    const { viewer } = open();
    const { max } = distanceLimits(room, 600 / 400);

    for (let i = 0; i < 60; i++) viewer.move("zoom-in");
    expect(distanceOf(viewer.getView())).toBeCloseTo(MIN_DISTANCE, 6);

    for (let i = 0; i < 60; i++) viewer.move("zoom-out");
    expect(distanceOf(viewer.getView())).toBeCloseTo(max, 6);
  });

  it("does not let the camera go below the floor, however far the user turns it", () => {
    const { viewer, canvas } = open();

    for (let i = 0; i < 40; i++) viewer.move("turn-up");
    const level = viewer.getView();
    expect(level.position.y).toBeGreaterThanOrEqual(level.target.y - 1e-6);
    expect(level.position.y).toBeGreaterThanOrEqual(0);

    drag(canvas, [300, 100], [300, 10000]);
    drag(canvas, [300, 300], [300, -10000]);
    expect(viewer.getView().position.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it("keeps the point looked at inside the room when the view is moved, so the room cannot be lost", () => {
    const { viewer } = open();
    const moves = ["move-left", "move-right", "move-up", "move-down"] as const;

    for (const move of moves) {
      for (let i = 0; i < 200; i++) viewer.move(move);
      const { target } = viewer.getView();
      expectInsideRoom(target, move);
      // ...and still well away from the middle, so the limit is not simply holding the view still.
      expect(target.distanceTo(new Vector3(0, 1.25, 0)), move).toBeGreaterThan(1);
    }
  });

  it("also keeps the point looked at inside the room when the user drags the view far away", () => {
    const { viewer, canvas } = open();

    drag(canvas, [100, 100], [5000, 3000], 2);

    expectInsideRoom(viewer.getView().target, "dragged");
  });
});

describe("resetView", () => {
  it("returns the camera to exactly where it started, after any amount of moving", () => {
    const { viewer, canvas } = open();
    const start = asArrays(viewer.getView());

    drag(canvas, [300, 200], [420, 150]);
    scroll(canvas, -300);
    drag(canvas, [300, 200], [250, 230], 2);
    viewer.move("turn-up");
    viewer.move("move-right");
    expect(asArrays(viewer.getView())).not.toEqual(start);

    viewer.resetView();

    expect(asArrays(viewer.getView())).toEqual(start);
  });

  it("draws the room again when the view is put back", () => {
    const { viewer, renderer } = open();
    viewer.move("turn-left");
    flushFrames();
    const before = renderer.render.mock.calls.length;

    viewer.resetView();
    flushFrames();

    expect(renderer.render.mock.calls.length).toBe(before + 1);
  });

  it("fits the room to the container as it is now, not as it was at the start", () => {
    const { viewer } = open();
    viewer.move("turn-left");
    frame.width = 300;
    frame.height = 600;
    FakeResizeObserver.instances[0].trigger();

    viewer.resetView();

    expectSameView(viewer.getView(), defaultView(room, 0.5));
  });

  it("does nothing once the viewer has been disposed", () => {
    const { viewer } = open();
    viewer.dispose();
    const after = asArrays(viewer.getView());

    expect(() => viewer.resetView()).not.toThrow();
    expect(() => viewer.move("zoom-in")).not.toThrow();
    expect(asArrays(viewer.getView())).toEqual(after);
  });
});

describe("when the container changes shape", () => {
  it("makes the picture fit and puts the whole room back in the frame, if the user has not moved the camera", () => {
    const { renderer, viewer } = open();
    frame.width = 300;
    frame.height = 600;

    FakeResizeObserver.instances[0].trigger();

    expect(renderer.setSize).toHaveBeenLastCalledWith(300, 600, false);
    expectSameView(viewer.getView(), defaultView(room, 0.5));
  });

  it("makes the picture fit but leaves the camera where the user put it", () => {
    const { renderer, viewer } = open();
    viewer.move("zoom-in");
    const placed = asArrays(viewer.getView());
    frame.width = 300;
    frame.height = 600;
    flushFrames();
    const drawn = renderer.render.mock.calls.length;

    FakeResizeObserver.instances[0].trigger();
    flushFrames();

    expect(renderer.setSize).toHaveBeenLastCalledWith(300, 600, false);
    expect(asArrays(viewer.getView())).toEqual(placed);
    expect(renderer.render.mock.calls.length).toBe(drawn + 1);
  });

  it("leaves a camera that the user has dragged where it is, as it does one that has been moved with the keys", () => {
    const { viewer, canvas } = open();
    drag(canvas, [300, 200], [380, 160]);
    const placed = asArrays(viewer.getView());
    frame.width = 300;
    frame.height = 600;

    FakeResizeObserver.instances[0].trigger();

    expect(asArrays(viewer.getView())).toEqual(placed);
  });

  it("fits the room to the new shape again once the view has been reset", () => {
    const { viewer } = open();
    viewer.move("zoom-in");
    viewer.resetView();
    frame.width = 300;
    frame.height = 600;

    FakeResizeObserver.instances[0].trigger();

    expectSameView(viewer.getView(), defaultView(room, 0.5));
  });

  it("draws the room again when the container grows but keeps its shape, since the picture is now bigger", () => {
    const { renderer } = open();
    flushFrames();
    frame.width = 1200;
    frame.height = 800;

    FakeResizeObserver.instances[0].trigger();
    flushFrames();

    expect(renderer.setSize).toHaveBeenLastCalledWith(1200, 800, false);
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it("applies the nearest and farthest distance for the new shape", () => {
    const { viewer } = open();
    frame.width = 300;
    frame.height = 600;
    FakeResizeObserver.instances[0].trigger();

    for (let i = 0; i < 80; i++) viewer.move("zoom-out");

    expect(distanceOf(viewer.getView())).toBeCloseTo(distanceLimits(room, 0.5).max, 6);
  });

  it("follows the window when the browser has no way to watch the container", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { renderer } = open();
    frame.width = 800;
    frame.height = 500;

    window.dispatchEvent(new Event("resize"));

    expect(renderer.setSize).toHaveBeenLastCalledWith(800, 500, false);
  });

  it("treats a container with no size yet as square instead of failing", () => {
    frame.width = 0;
    frame.height = 0;

    const { viewer, renderer } = open();
    flushFrames();

    expectSameView(viewer.getView(), defaultView(room, 1));
    const [, camera] = renderer.render.mock.calls[0] as [Scene, PerspectiveCamera];
    expect(camera.aspect).toBe(1);
  });
});

describe("the graphics context", () => {
  it("lets the browser restore a context it lost, and draws again when it comes back", () => {
    const { canvas, renderer } = open();
    flushFrames();

    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    flushFrames();

    expect(lost.defaultPrevented).toBe(true);
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });
});

describe("dispose", () => {
  it("removes the picture from the container and gives the graphics context back", () => {
    const { container, viewer, renderer, canvas } = open();

    viewer.dispose();

    expect(container.contains(canvas)).toBe(false);
    expect(container.childElementCount).toBe(0);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it("stops watching the container and the window", () => {
    const { viewer } = open();

    viewer.dispose();

    expect(FakeResizeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not draw a frame that was still waiting", () => {
    const { viewer, renderer } = open();
    flushFrames();
    viewer.move("zoom-in");
    expect(pending.size).toBe(1);

    viewer.dispose();
    flushFrames();

    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it("stops listening to the mouse and the touch screen", () => {
    const { viewer, canvas } = open();
    const before = asArrays(viewer.getView());
    viewer.dispose();
    // Back in the page, as if something still held the picture: it must not react any more.
    document.body.append(canvas);

    drag(canvas, [300, 200], [400, 100]);
    scroll(canvas, -200);

    expect(asArrays(viewer.getView())).toEqual(before);
  });

  it("can be called more than once", () => {
    const { viewer, renderer } = open();

    viewer.dispose();
    expect(() => viewer.dispose()).not.toThrow();

    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it("frees the room that was drawn", () => {
    const { viewer, renderer } = open();
    flushFrames();
    const [scene] = renderer.render.mock.calls[0] as [Scene];
    const floor = scene.getObjectByName("floor") as unknown as { geometry: { dispose: () => void } };
    const dispose = vi.spyOn(floor.geometry, "dispose");

    viewer.dispose();

    expect(dispose).toHaveBeenCalled();
  });
});
