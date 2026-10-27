"use client";

import { useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import { formatMetres, type RoomSize } from "../shared/room";
import { createRoomViewer, type CameraMove, type RoomViewer } from "../viewer";

/** What a key does to the view: arrow keys turn the room, + and - zoom, Shift with an arrow key moves the view. */
function moveForKey(event: KeyboardEvent): CameraMove | null {
  // Keys with Ctrl, Alt or the system key mean something to the browser, such as Ctrl and + to zoom the page.
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  switch (event.key) {
    case "ArrowLeft":
      return event.shiftKey ? "move-left" : "turn-left";
    case "ArrowRight":
      return event.shiftKey ? "move-right" : "turn-right";
    case "ArrowUp":
      return event.shiftKey ? "move-up" : "turn-up";
    case "ArrowDown":
      return event.shiftKey ? "move-down" : "turn-down";
    case "+":
    case "=":
      return "zoom-in";
    case "-":
    case "_":
      return "zoom-out";
    default:
      return null;
  }
}

const BUTTON =
  "shrink-0 rounded-full border border-black/15 px-4 py-1.5 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/20 dark:hover:bg-white/10";

/**
 * An empty room in 3D, in the size given, which the user can look around with the mouse, the
 * touch screen or the keyboard, and put back to its starting view. If the browser cannot show 3D,
 * it says so instead.
 */
export function Room3DView({ room }: { room: RoomSize }) {
  const viewer = useRef<RoomViewer | null>(null);
  const [failed, setFailed] = useState(false);
  const hintId = useId();
  const { width_m, length_m, height_m } = room;

  // The viewer lives as long as the element it draws in: React calls this when the element is put
  // on the page and runs what it returns when the element goes, or when the room size changes.
  const mount = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      try {
        const created = createRoomViewer(element, { width_m, length_m, height_m });
        viewer.current = created;
        return () => {
          created.dispose();
          viewer.current = null;
        };
      } catch {
        // Most often the browser has no WebGL, or has used up the graphics contexts it allows.
        setFailed(true);
      }
    },
    [width_m, length_m, height_m],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const move = moveForKey(event);
    if (!move) return;
    // The arrow keys would otherwise scroll the page.
    event.preventDefault();
    viewer.current?.move(move);
  }

  if (failed) {
    return (
      <div
        role="alert"
        className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
      >
        The 3D view could not start. It needs WebGL, which this browser or device does not offer
        right now. The room description below is still right: it describes the same room.
      </div>
    );
  }

  const width = formatMetres(width_m);
  const length = formatMetres(length_m);
  const height = formatMetres(height_m);

  return (
    <div className="flex flex-col gap-3">
      {/* select-none: turning the room and letting go outside the view must not select the page's text. */}
      <div
        ref={mount}
        role="group"
        aria-label={`3D view of the room: ${width} m wide, ${length} m long, ${height} m high`}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="h-80 w-full overflow-hidden rounded-lg border border-black/10 bg-black/4 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:h-112 dark:border-white/15 dark:bg-white/6"
      />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {width} × {length} m, {height} m high. The lines on the floor are 1 m apart.
        </p>
        <button type="button" onClick={() => viewer.current?.resetView()} className={BUTTON}>
          Reset view
        </button>
      </div>

      <p id={hintId} className="text-sm text-zinc-600 dark:text-zinc-400">
        Drag to turn the room, scroll or pinch to zoom, and drag with the right button or with two
        fingers to move the view. With a keyboard, Tab to the view: the arrow keys turn it, + and −
        zoom, and Shift with an arrow key moves it.
      </p>
    </div>
  );
}
