import { PerspectiveCamera, WebGLRenderer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { RoomSize } from "../shared/room";
import {
  FIELD_OF_VIEW,
  clampTarget,
  defaultView,
  distanceLimits,
  moveView,
  type CameraMove,
  type CameraView,
} from "./camera-view";
import { createRoomScene, disposeScene } from "./room-scene";

/** A 3D view of a room in a page, which the user can look around. */
export type RoomViewer = {
  /** Puts the camera back where it started. */
  resetView(): void;
  /** Moves the camera one step, as the keyboard does. */
  move(move: CameraMove): void;
  /** Where the camera is and the point it looks at. */
  getView(): CameraView;
  /** Stops the viewer and frees what it holds on the graphics card. The container is empty afterwards. */
  dispose(): void;
};

/**
 * Shows an empty room of the given size in the container, which should have a size of its own.
 * Dragging turns the room, scrolling or pinching zooms, and dragging with the right button or with
 * two fingers moves the view. The room is drawn only when something changes.
 *
 * Throws if the browser cannot make a WebGL context. Nothing has been added to the page then.
 */
export function createRoomViewer(container: HTMLElement, room: RoomSize): RoomViewer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
  canvas.setAttribute("aria-hidden", "true");
  container.append(canvas);

  const scene = createRoomScene(room);
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 1000);
  const controls = new OrbitControls(camera, canvas);
  // Turning stops when the camera is level with the point it looks at, so it never goes under the floor.
  controls.maxPolarAngle = Math.PI / 2;
  // A hand over the room, closed while it is dragged, to show that it can be turned.
  controls.cursorStyle = "grab";

  let disposed = false;
  let frame = 0;
  // Whether the user has moved the camera since it was last put at the start. If not, a change of
  // the frame's shape (a phone turned on its side) puts it at the start again to fit the room.
  let moved = false;

  const draw = () => {
    frame = 0;
    if (!disposed) renderer.render(scene, camera);
  };
  const requestDraw = () => {
    if (!disposed && frame === 0) frame = requestAnimationFrame(draw);
  };

  const currentView = (): CameraView => ({
    position: camera.position.clone(),
    target: controls.target.clone(),
  });

  const show = (view: CameraView) => {
    camera.position.copy(view.position);
    controls.target.copy(view.target);
    controls.update();
    requestDraw();
  };

  const fit = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width > 0 && height > 0 ? width / height : 1;
    camera.updateProjectionMatrix();

    const { min, max } = distanceLimits(room, camera.aspect);
    controls.minDistance = min;
    controls.maxDistance = max;
    if (moved) requestDraw();
    else show(defaultView(room, camera.aspect));
  };

  controls.addEventListener("start", () => {
    moved = true;
  });
  controls.addEventListener("change", () => {
    // The point looked at stays inside the room, so that moving the view cannot lose the room.
    const inside = clampTarget(controls.target, room);
    if (!inside.equals(controls.target)) {
      camera.position.add(inside.clone().sub(controls.target));
      controls.target.copy(inside);
    }
    requestDraw();
  });

  // Letting the browser know the lost context may come back is what makes it restore it.
  const keepContext = (event: Event) => event.preventDefault();
  canvas.addEventListener("webglcontextlost", keepContext);
  canvas.addEventListener("webglcontextrestored", requestDraw);

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
  if (resizeObserver) resizeObserver.observe(container);
  else window.addEventListener("resize", fit);

  fit();

  return {
    resetView() {
      if (disposed) return;
      moved = false;
      show(defaultView(room, camera.aspect));
    },
    move(move) {
      if (disposed) return;
      moved = true;
      show(moveView(currentView(), move));
    },
    getView: currentView,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", fit);
      canvas.removeEventListener("webglcontextlost", keepContext);
      canvas.removeEventListener("webglcontextrestored", requestDraw);
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      // Browsers allow only a few graphics contexts at once, so give this one back now.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
