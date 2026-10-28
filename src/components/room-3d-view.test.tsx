// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { typicalItem, type FurnitureItem } from "../shared/furniture";
import type { RoomSize } from "../shared/room";
import type { RoomDescription } from "../shared/room-description";
import { arrangeInRows, createRoomViewer, type CameraMove, type FurnitureReport, type RoomViewer } from "../viewer";
import { Room3DView } from "./room-3d-view";

// The viewer needs WebGL, which jsdom does not have, so it is replaced by one that records what it is
// asked. The rest of the viewer module, such as the arrangement of the furniture, is the real one.
vi.mock("../viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../viewer")>()),
  createRoomViewer: vi.fn(),
}));
const create = vi.mocked(createRoomViewer);

const room: RoomSize = { width_m: 6, length_m: 4.5, height_m: 2.5 };
const sofa = typicalItem("sofa");
const table = typicalItem("coffee_table");
const describing = (furniture: FurnitureItem[] = [sofa, table], size: RoomSize = room): RoomDescription => ({ room: size, furniture });
const description = describing();

type FakeViewer = {
  resetView: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  showFurniture: ReturnType<typeof vi.fn>;
};
let viewers: FakeViewer[];
// What the next viewers answer when they are asked to show furniture.
let answer: () => Promise<FurnitureReport | null>;

beforeEach(() => {
  viewers = [];
  answer = async () => ({ count: 2, unmatched: [] });
  create.mockImplementation(() => {
    const viewer: FakeViewer = {
      resetView: vi.fn(),
      move: vi.fn(),
      dispose: vi.fn(),
      showFurniture: vi.fn(() => answer()),
    };
    viewers.push(viewer);
    return viewer as unknown as RoomViewer;
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** Renders the view and lets the furniture that the fake viewer answers at once come in. */
async function show(ui: ReactElement) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui);
  });
  return result;
}

/** A promise that is answered by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const view = () => screen.getByRole("group", { name: /^3D view of the room/ });
const LOADING = "Loading the furniture…";

describe("Room3DView", () => {
  it("shows a 3D view of the room, labelled with its size and its furniture, and makes the viewer inside it", async () => {
    await show(<Room3DView description={description} />);

    const group = screen.getByRole("group", { name: "3D view of the room: 6 m wide, 4.5 m long, 2.5 m high, with 2 pieces of furniture" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(group, room);
  });

  it("says 1 piece, not 1 pieces", async () => {
    await show(<Room3DView description={describing([sofa])} />);

    expect(view().getAttribute("aria-label")).toBe("3D view of the room: 6 m wide, 4.5 m long, 2.5 m high, with 1 piece of furniture");
  });

  it("says how big the room is and how far apart the lines on the floor are", async () => {
    await show(<Room3DView description={description} />);

    expect(screen.getByText("6 × 4.5 m, 2.5 m high. The lines on the floor are 1 m apart.")).toBeTruthy();
  });

  it("explains how to look around with the mouse, the touch screen and the keyboard, and the view is described by it", async () => {
    await show(<Room3DView description={description} />);

    const hint = document.getElementById(view().getAttribute("aria-describedby")!)!;
    expect(hint.textContent).toContain("Drag to turn the room");
    expect(hint.textContent).toContain("scroll or pinch to zoom");
    expect(hint.textContent).toContain("right button or with two fingers");
    expect(hint.textContent).toContain("arrow keys turn it");
  });

  it("can be reached with the keyboard", async () => {
    const user = userEvent.setup();
    await show(<Room3DView description={description} />);

    await user.tab();

    expect(document.activeElement).toBe(view());
  });
});

describe("Room3DView: the furniture (AC1)", () => {
  it("puts the furniture in the viewer, lined up in the arrangement for the room, one place for each piece", async () => {
    await show(<Room3DView description={description} />);

    const places = arrangeInRows(room, description.furniture);
    expect(viewers[0].showFurniture).toHaveBeenCalledTimes(1);
    expect(viewers[0].showFurniture).toHaveBeenCalledWith([
      { item: sofa, placement: places[0] },
      { item: table, placement: places[1] },
    ]);
  });

  it("says that the furniture is loading until the viewer has it, and then says nothing", async () => {
    const waiting = deferred<FurnitureReport>();
    answer = () => waiting.promise;
    await show(<Room3DView description={description} />);
    expect(screen.getByText(LOADING)).toBeTruthy();

    await act(async () => waiting.resolve({ count: 2, unmatched: [] }));

    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("keeps a live region on the page all the time, so that a screen reader says what comes into it", async () => {
    await show(<Room3DView description={description} />);

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("says nothing about boxes when every piece is a model", async () => {
    await show(<Room3DView description={description} />);

    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByText(/plain grey/)).toBeNull();
  });
});

describe("Room3DView: pieces that are plain boxes (AC2)", () => {
  it("tells the user which piece, by its name and its place in the list", async () => {
    answer = async () => ({ count: 2, unmatched: [{ index: 1, type: "coffee_table", reason: "no-model" }] });

    await show(<Room3DView description={description} />);

    expect(screen.getByRole("status").textContent).toBe(
      "1 piece is shown as a plain grey box of its size, because no 3D model could be loaded for it: Coffee table (item 2).",
    );
  });

  it("lists every piece, in the plural, when there are several", async () => {
    answer = async () => ({
      count: 4,
      unmatched: [
        { index: 0, type: "sofa", reason: "no-model" },
        { index: 2, type: "tv_stand", reason: "load-failed" },
        { index: 3, type: "sofa", reason: "no-model" },
      ],
    });

    await show(<Room3DView description={describing([sofa, table, typicalItem("tv_stand"), sofa])} />);

    expect(screen.getByRole("status").textContent).toBe(
      "3 pieces are shown as plain grey boxes of their size, because no 3D model could be loaded for them: Sofa (item 1), TV stand (item 3), Sofa (item 4).",
    );
  });

  it("does not say it while the furniture is still loading", async () => {
    answer = () => new Promise(() => {});

    await show(<Room3DView description={description} />);

    expect(screen.getByRole("status").textContent).toBe(LOADING);
  });

  it("still lets the user look around the room that has the boxes in it", async () => {
    const user = userEvent.setup();
    answer = async () => ({ count: 2, unmatched: [{ index: 0, type: "sofa", reason: "load-failed" }] });
    await show(<Room3DView description={description} />);

    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(viewers[0].resetView).toHaveBeenCalledTimes(1);
  });
});

describe("Room3DView: when the furniture or the room changes", () => {
  it("shows the new furniture in the same viewer, and says it is loading until it is in", async () => {
    const { rerender } = await show(<Room3DView description={description} />);
    const waiting = deferred<FurnitureReport>();
    answer = () => waiting.promise;

    await act(async () => rerender(<Room3DView description={describing([typicalItem("bed")])} />));

    expect(viewers).toHaveLength(1);
    expect(viewers[0].dispose).not.toHaveBeenCalled();
    expect(viewers[0].showFurniture).toHaveBeenCalledTimes(2);
    expect(viewers[0].showFurniture.mock.calls[1][0].map((piece: { item: FurnitureItem }) => piece.item.label)).toEqual(["bed"]);
    expect(screen.getByText(LOADING)).toBeTruthy();

    await act(async () => waiting.resolve({ count: 1, unmatched: [] }));
    expect(screen.queryByText(LOADING)).toBeNull();
  });

  it("does not show what was said about the old furniture for the new", async () => {
    answer = async () => ({ count: 2, unmatched: [{ index: 1, type: "coffee_table", reason: "no-model" }] });
    const { rerender } = await show(<Room3DView description={description} />);
    expect(screen.getByText(/plain grey box/)).toBeTruthy();
    answer = () => new Promise(() => {});

    await act(async () => rerender(<Room3DView description={describing([sofa])} />));

    expect(screen.queryByText(/plain grey box/)).toBeNull();
    expect(screen.getByText(LOADING)).toBeTruthy();
  });

  it("puts the furniture in a new viewer when the room size changes, and not in the one that was stopped", async () => {
    const { rerender } = await show(<Room3DView description={description} />);

    // The furniture is the very same list: only the room has changed.
    await act(async () => rerender(<Room3DView description={{ room: { ...room, width_m: 8 }, furniture: description.furniture }} />));

    expect(viewers).toHaveLength(2);
    expect(viewers[0].dispose).toHaveBeenCalledTimes(1);
    expect(viewers[0].showFurniture).toHaveBeenCalledTimes(1);
    expect(viewers[1].showFurniture).toHaveBeenCalledTimes(1);
    // The arrangement is made for the new size of the room.
    const places = arrangeInRows({ ...room, width_m: 8 }, [sofa, table]);
    expect(viewers[1].showFurniture).toHaveBeenCalledWith([
      { item: sofa, placement: places[0] },
      { item: table, placement: places[1] },
    ]);
  });

  it("ignores what comes in for furniture that has been replaced since, however late", async () => {
    const first = deferred<FurnitureReport>();
    const second = deferred<FurnitureReport>();
    const answers = [first.promise, second.promise];
    answer = () => answers.shift()!;
    const { rerender } = await show(<Room3DView description={description} />);
    await act(async () => rerender(<Room3DView description={describing([sofa])} />));

    // The first answer comes last, and says that a piece is a box: it is not about this furniture.
    await act(async () => second.resolve({ count: 1, unmatched: [] }));
    await act(async () => first.resolve({ count: 2, unmatched: [{ index: 0, type: "sofa", reason: "no-model" }] }));

    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.queryByText(/plain grey/)).toBeNull();
  });

  it("waits for the answer about this furniture when the viewer answers null, as it does for a call that was replaced", async () => {
    const answers = [Promise.resolve(null), new Promise<FurnitureReport | null>(() => {})];
    answer = () => answers.shift()!;

    const { rerender } = await show(<Room3DView description={description} />);
    await act(async () => rerender(<Room3DView description={describing([sofa])} />));

    expect(screen.getByText(LOADING)).toBeTruthy();
  });

  it("does not change anything when the answer comes after the view was taken off the page", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const waiting = deferred<FurnitureReport>();
    answer = () => waiting.promise;
    const { unmount } = await show(<Room3DView description={description} />);

    unmount();
    await act(async () => waiting.resolve({ count: 2, unmatched: [] }));

    expect(errors).not.toHaveBeenCalled();
  });
});

describe("Room3DView: Reset view", () => {
  it("puts the camera back when Reset view is pressed", async () => {
    const user = userEvent.setup();
    await show(<Room3DView description={description} />);

    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(viewers[0].resetView).toHaveBeenCalledTimes(1);
  });

  it("can be pressed with the keyboard", async () => {
    const user = userEvent.setup();
    await show(<Room3DView description={description} />);

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
    await show(<Room3DView description={description} />);
    await user.tab();

    await user.keyboard(keys);

    expect(viewers[0].move).toHaveBeenCalledTimes(1);
    expect(viewers[0].move).toHaveBeenCalledWith(move);
  });

  it("keeps moving while a key is held down", async () => {
    const user = userEvent.setup();
    await show(<Room3DView description={description} />);
    await user.tab();

    await user.keyboard("{ArrowRight>3/}");

    expect(viewers[0].move.mock.calls.filter(([move]) => move === "turn-right").length).toBeGreaterThanOrEqual(3);
  });

  it("stops the page scrolling when a key moves the view", async () => {
    await show(<Room3DView description={description} />);

    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"]) {
      expect(fireEvent.keyDown(view(), { key }), key).toBe(false);
    }
  });

  it("leaves every other key to the page and the browser", async () => {
    await show(<Room3DView description={description} />);

    for (const key of ["Tab", "Enter", " ", "PageDown", "Home", "a", "Escape"]) {
      expect(fireEvent.keyDown(view(), { key }), key).toBe(true);
    }
    expect(viewers[0].move).not.toHaveBeenCalled();
  });

  it("leaves shortcuts of the browser alone, such as Ctrl and + to zoom the page or Alt and an arrow key to go back", async () => {
    await show(<Room3DView description={description} />);

    for (const modifier of ["ctrlKey", "altKey", "metaKey"]) {
      for (const key of ["+", "-", "ArrowLeft", "ArrowDown"]) {
        expect(fireEvent.keyDown(view(), { key, [modifier]: true }), `${modifier} ${key}`).toBe(true);
      }
    }
    expect(viewers[0].move).not.toHaveBeenCalled();
  });
});

describe("Room3DView: the viewer's life", () => {
  it("stops the viewer when the view is taken off the page", async () => {
    const { unmount } = await show(<Room3DView description={description} />);

    unmount();

    expect(viewers[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("makes a new viewer for a new room size, and stops the old one", async () => {
    const { rerender } = await show(<Room3DView description={description} />);

    await act(async () => rerender(<Room3DView description={describing([sofa, table], { ...room, width_m: 8 })} />));

    expect(viewers).toHaveLength(2);
    expect(viewers[0].dispose).toHaveBeenCalledTimes(1);
    expect(viewers[1].dispose).not.toHaveBeenCalled();
    expect(create).toHaveBeenLastCalledWith(expect.anything(), { width_m: 8, length_m: 4.5, height_m: 2.5 });
  });

  it("keeps the viewer, and does not ask for the furniture again, when the same description comes again", async () => {
    const { rerender } = await show(<Room3DView description={description} />);

    await act(async () => rerender(<Room3DView description={description} />));

    expect(viewers).toHaveLength(1);
    expect(viewers[0].dispose).not.toHaveBeenCalled();
    expect(viewers[0].showFurniture).toHaveBeenCalledTimes(1);
  });

  it("keeps exactly one viewer alive, with its furniture, when React runs the effects twice, as it does while developing", async () => {
    await show(
      <StrictMode>
        <Room3DView description={description} />
      </StrictMode>,
    );

    const alive = viewers.filter((viewer) => viewer.dispose.mock.calls.length === 0);
    expect(alive).toHaveLength(1);
    expect(alive[0].showFurniture).toHaveBeenCalled();
    // However often it was asked, the user is not told that the furniture is loading when it has come in.
    await waitFor(() => expect(screen.queryByText(LOADING)).toBeNull());
  });

  it("sends the keys and Reset to the viewer that is alive now, not to one that was stopped", async () => {
    const user = userEvent.setup();
    const { rerender } = await show(<Room3DView description={description} />);
    await act(async () => rerender(<Room3DView description={describing([sofa, table], { ...room, length_m: 7 })} />));
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

  it("says the 3D view could not start, and why, instead of showing a view that does nothing", async () => {
    await show(<Room3DView description={description} />);

    const message = screen.getByRole("alert").textContent!;
    expect(message).toContain("The 3D view could not start");
    expect(message).toContain("WebGL");
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset view" })).toBeNull();
    expect(screen.queryByText(LOADING)).toBeNull();
  });
});
