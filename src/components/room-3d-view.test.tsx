// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomSize } from "../shared/room";
import { createRoomViewer, type CameraMove, type RoomViewer } from "../viewer";
import { Room3DView } from "./room-3d-view";

// The viewer needs WebGL, which jsdom does not have, so it is replaced by one that records what it is asked.
vi.mock("../viewer", () => ({ createRoomViewer: vi.fn() }));
const create = vi.mocked(createRoomViewer);

const room: RoomSize = { width_m: 6, length_m: 4.5, height_m: 2.5 };

type FakeViewer = { resetView: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
let viewers: FakeViewer[];

beforeEach(() => {
  viewers = [];
  create.mockImplementation(() => {
    const viewer: FakeViewer = { resetView: vi.fn(), move: vi.fn(), dispose: vi.fn() };
    viewers.push(viewer);
    return viewer as unknown as RoomViewer;
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const view = () => screen.getByRole("group", { name: /^3D view of the room/ });

describe("Room3DView", () => {
  it("shows a 3D view of the room, labelled with its size, and makes the viewer inside it", () => {
    render(<Room3DView room={room} />);

    const group = screen.getByRole("group", { name: "3D view of the room: 6 m wide, 4.5 m long, 2.5 m high" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(group, room);
  });

  it("says how big the room is and how far apart the lines on the floor are", () => {
    render(<Room3DView room={room} />);

    expect(screen.getByText("6 × 4.5 m, 2.5 m high. The lines on the floor are 1 m apart.")).toBeTruthy();
  });

  it("explains how to look around with the mouse, the touch screen and the keyboard, and the view is described by it", () => {
    render(<Room3DView room={room} />);

    const hint = document.getElementById(view().getAttribute("aria-describedby")!)!;
    expect(hint.textContent).toContain("Drag to turn the room");
    expect(hint.textContent).toContain("scroll or pinch to zoom");
    expect(hint.textContent).toContain("right button or with two fingers");
    expect(hint.textContent).toContain("arrow keys turn it");
  });

  it("can be reached with the keyboard", async () => {
    const user = userEvent.setup();
    render(<Room3DView room={room} />);

    await user.tab();

    expect(document.activeElement).toBe(view());
  });
});

describe("Room3DView: Reset view", () => {
  it("puts the camera back when Reset view is pressed", async () => {
    const user = userEvent.setup();
    render(<Room3DView room={room} />);

    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(viewers[0].resetView).toHaveBeenCalledTimes(1);
  });

  it("can be pressed with the keyboard", async () => {
    const user = userEvent.setup();
    render(<Room3DView room={room} />);

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset view" }));
    await user.keyboard("{Enter}");

    expect(viewers[0].resetView).toHaveBeenCalledTimes(1);
  });
});

describe("Room3DView: the keyboard", () => {
  it.each<[string, CameraMove]>([
    ["{ArrowLeft}", "turn-left"],
    ["{ArrowRight}", "turn-right"],
    ["{ArrowUp}", "turn-up"],
    ["{ArrowDown}", "turn-down"],
    ["+", "zoom-in"],
    ["=", "zoom-in"],
    ["-", "zoom-out"],
    ["_", "zoom-out"],
    ["{Shift>}{ArrowLeft}{/Shift}", "move-left"],
    ["{Shift>}{ArrowRight}{/Shift}", "move-right"],
    ["{Shift>}{ArrowUp}{/Shift}", "move-up"],
    ["{Shift>}{ArrowDown}{/Shift}", "move-down"],
  ])("%s moves the view: %s", async (keys, move) => {
    const user = userEvent.setup();
    render(<Room3DView room={room} />);
    await user.tab();

    await user.keyboard(keys);

    expect(viewers[0].move).toHaveBeenCalledTimes(1);
    expect(viewers[0].move).toHaveBeenCalledWith(move);
  });

  it("keeps moving while a key is held down", async () => {
    const user = userEvent.setup();
    render(<Room3DView room={room} />);
    await user.tab();

    await user.keyboard("{ArrowRight>3/}");

    expect(viewers[0].move.mock.calls.filter(([move]) => move === "turn-right").length).toBeGreaterThanOrEqual(3);
  });

  it("stops the page scrolling when a key moves the view", () => {
    render(<Room3DView room={room} />);

    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"]) {
      expect(fireEvent.keyDown(view(), { key }), key).toBe(false);
    }
  });

  it("leaves every other key to the page and the browser", () => {
    render(<Room3DView room={room} />);

    for (const key of ["Tab", "Enter", " ", "PageDown", "Home", "a", "Escape"]) {
      expect(fireEvent.keyDown(view(), { key }), key).toBe(true);
    }
    expect(viewers[0].move).not.toHaveBeenCalled();
  });

  it("leaves shortcuts of the browser alone, such as Ctrl and + to zoom the page or Alt and an arrow key to go back", () => {
    render(<Room3DView room={room} />);

    for (const modifier of ["ctrlKey", "altKey", "metaKey"]) {
      for (const key of ["+", "-", "ArrowLeft", "ArrowDown"]) {
        expect(fireEvent.keyDown(view(), { key, [modifier]: true }), `${modifier} ${key}`).toBe(true);
      }
    }
    expect(viewers[0].move).not.toHaveBeenCalled();
  });
});

describe("Room3DView: the viewer's life", () => {
  it("stops the viewer when the view is taken off the page", () => {
    const { unmount } = render(<Room3DView room={room} />);

    unmount();

    expect(viewers[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("makes a new viewer for a new room size, and stops the old one", () => {
    const { rerender } = render(<Room3DView room={room} />);

    rerender(<Room3DView room={{ ...room, width_m: 8 }} />);

    expect(viewers).toHaveLength(2);
    expect(viewers[0].dispose).toHaveBeenCalledTimes(1);
    expect(viewers[1].dispose).not.toHaveBeenCalled();
    expect(create).toHaveBeenLastCalledWith(expect.anything(), { width_m: 8, length_m: 4.5, height_m: 2.5 });
  });

  it("keeps the viewer when the same size comes again in a new object", () => {
    const { rerender } = render(<Room3DView room={room} />);

    rerender(<Room3DView room={{ ...room }} />);

    expect(viewers).toHaveLength(1);
    expect(viewers[0].dispose).not.toHaveBeenCalled();
  });

  it("keeps exactly one viewer alive when React runs the effects twice, as it does while developing", () => {
    render(
      <StrictMode>
        <Room3DView room={room} />
      </StrictMode>,
    );

    expect(viewers.filter((viewer) => viewer.dispose.mock.calls.length === 0)).toHaveLength(1);
  });

  it("sends the keys and Reset to the viewer that is alive now, not to one that was stopped", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Room3DView room={room} />);
    rerender(<Room3DView room={{ ...room, length_m: 7 }} />);
    await user.tab();

    await user.keyboard("{ArrowLeft}");
    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(viewers[0].move).not.toHaveBeenCalled();
    expect(viewers[0].resetView).not.toHaveBeenCalled();
    expect(viewers[1].move).toHaveBeenCalledWith("turn-left");
    expect(viewers[1].resetView).toHaveBeenCalledTimes(1);
  });
});

describe("Room3DView: a browser without WebGL", () => {
  beforeEach(() => {
    create.mockImplementation(() => {
      throw new Error("Error creating WebGL context.");
    });
  });

  it("says the 3D view could not start, and why, instead of showing a view that does nothing", () => {
    render(<Room3DView room={room} />);

    const message = screen.getByRole("alert").textContent!;
    expect(message).toContain("The 3D view could not start");
    expect(message).toContain("WebGL");
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset view" })).toBeNull();
  });
});
