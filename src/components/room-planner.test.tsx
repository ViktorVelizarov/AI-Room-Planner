// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectOutcome } from "../client/detect-client";
import { requestDetection } from "../client/detect-client";
import type { LayoutOutcome } from "../client/layout-client";
import { requestLayout } from "../client/layout-client";
import type { StyledLayout, StyleFailure } from "../shared/api";
import { LAYOUT_STYLES, STYLE_NAMES, type LayoutStyle } from "../shared/layout-styles";
import { createRoomViewer, type FurnitureReport, type RoomViewer } from "../viewer";
import { RoomPlanner } from "./room-planner";

vi.mock("../client/detect-client", () => ({ requestDetection: vi.fn() }));
const detect = vi.mocked(requestDetection);

vi.mock("../client/layout-client", () => ({ requestLayout: vi.fn() }));
const layoutRequest = vi.mocked(requestLayout);

// The 3D view needs WebGL, which jsdom does not have, so the viewer is replaced by one that records what it is asked.
// The rest of the viewer module, such as the arrangement of the furniture, is the real one.
vi.mock("../viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../viewer")>()),
  createRoomViewer: vi.fn(),
}));
const createViewer = vi.mocked(createRoomViewer);
type FakeViewer = {
  resetView: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  showFurniture: ReturnType<typeof vi.fn>;
};
let viewers: FakeViewer[];
// What the viewers answer when they are asked to show furniture.
let furnitureReport: FurnitureReport = { count: 1, unmatched: [] };

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: (file: Blob) => `blob:preview/${(file as File).name}`,
    revokeObjectURL: vi.fn(),
  });
  viewers = [];
  furnitureReport = { count: 1, unmatched: [] };
  createViewer.mockImplementation(() => {
    const viewer: FakeViewer = {
      resetView: vi.fn(),
      move: vi.fn(),
      dispose: vi.fn(),
      showFurniture: vi.fn(async () => furnitureReport),
    };
    viewers.push(viewer);
    return viewer as unknown as RoomViewer;
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const success: DetectOutcome = {
  ok: true,
  data: {
    items: [
      { label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "grey", material: "fabric" },
    ],
    unsupported: 0,
    calls: { used: 1, limit: 10 },
  },
};

const setup = () => {
  const { container } = render(<RoomPlanner />);
  const user = userEvent.setup({ applyAccept: false });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

  // The three steps. Steps that are not current are hidden, so only the current one can be found by role.
  const step = (name: string) => screen.queryByRole("group", { name });
  const currentStep = () =>
    screen.queryAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")?.textContent;

  /** Photos added and furniture detected: the point where the user can go on. */
  const detectFurniture = async () => {
    await user.upload(input, [new File([new Uint8Array(100)], "a.jpg", { type: "image/jpeg" })]);
    await user.click(screen.getByRole("button", { name: "Detect furniture" }));
    await screen.findByRole("button", { name: "Continue to room size" });
  };
  const enter = async (label: string, value: string) => {
    const field = screen.getByLabelText(label);
    await user.clear(field);
    await user.click(field);
    await user.paste(value);
  };
  return { user, step, currentStep, detectFurniture, enter };
};

describe("RoomPlanner", () => {
  it("starts on the photos step, with the room size not yet reachable", () => {
    const { step, currentStep } = setup();

    expect(currentStep()).toContain("Photos");
    expect(step("Photos")).toBeTruthy();
    expect(step("Room size")).toBeNull();
    expect(step("Your room")).toBeNull();
    expect(step("3D room")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue to room size" })).toBeNull();
  });

  it("offers the room size step only once furniture has been detected", async () => {
    detect.mockResolvedValue(success);
    const { user } = setup();
    await user.upload(
      document.querySelector('input[type="file"]')!,
      [new File([new Uint8Array(100)], "a.jpg", { type: "image/jpeg" })],
    );
    expect(screen.queryByRole("button", { name: "Continue to room size" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Detect furniture" }));

    expect(await screen.findByRole("button", { name: "Continue to room size" })).toBeTruthy();
  });

  it("takes the user to the room size step, with the default size ready", async () => {
    detect.mockResolvedValue(success);
    const { user, step, currentStep, detectFurniture } = setup();
    await detectFurniture();

    await user.click(screen.getByRole("button", { name: "Continue to room size" }));

    expect(currentStep()).toContain("Room size");
    expect(step("Room size")).toBeTruthy();
    expect(step("Photos")).toBeNull();
    expect((screen.getByLabelText("Width (m)") as HTMLInputElement).value).toBe("4");
  });

  it("moves the focus to the new step, since the button that was pressed is gone", async () => {
    detect.mockResolvedValue(success);
    const { user, step, detectFurniture } = setup();
    await detectFurniture();

    await user.click(screen.getByRole("button", { name: "Continue to room size" }));

    expect(document.activeElement).toBe(step("Room size"));
  });

  it("keeps the photos and the furniture list when the user goes back", async () => {
    detect.mockResolvedValue(success);
    const { user, step, detectFurniture } = setup();
    await detectFurniture();
    await user.click(screen.getByRole("button", { name: "Continue to room size" }));

    await user.click(screen.getByRole("button", { name: "Back" }));

    const photos = within(step("Photos")!);
    expect(photos.getByRole("img", { name: "Preview of a.jpg" })).toBeTruthy();
    expect(photos.getByText("Detected furniture (1)")).toBeTruthy();
    expect(photos.getByRole("button", { name: "Continue to room size" })).toBeTruthy();
    expect(detect).toHaveBeenCalledTimes(1); // nothing was detected again
  });

  it("shows the size that was entered, and the furniture, in the next step", async () => {
    detect.mockResolvedValue(success);
    const { user, step, currentStep, detectFurniture, enter } = setup();
    await detectFurniture();
    await user.click(screen.getByRole("button", { name: "Continue to room size" }));
    await enter("Width (m)", "6");
    await enter("Length (m)", "4,5");

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(currentStep()).toContain("Your room");
    const summary = within(step("Your room")!);
    expect(summary.getByText("6 × 4.5 m, 2.5 m high")).toBeTruthy();
    expect(summary.getByText("Furniture in your room (1)")).toBeTruthy();
    expect(summary.getByRole("button", { name: /^Edit Sofa/ })).toBeTruthy(); // the sofa's own row
  });

  it("does not move on while a value is wrong", async () => {
    detect.mockResolvedValue(success);
    const { user, currentStep, detectFurniture, enter } = setup();
    await detectFurniture();
    await user.click(screen.getByRole("button", { name: "Continue to room size" }));
    await enter("Height (m)", "9");

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(currentStep()).toContain("Room size");
    expect(screen.getByText("Height must be between 2 and 5 m.")).toBeTruthy();
  });

  it("replaces the size when the user goes back and changes it", async () => {
    detect.mockResolvedValue(success);
    const { user, step, detectFurniture, enter } = setup();
    await detectFurniture();
    await user.click(screen.getByRole("button", { name: "Continue to room size" }));
    await enter("Width (m)", "6");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(within(step("Your room")!).getByText("6 × 5 m, 2.5 m high")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back to room size" }));
    expect((screen.getByLabelText("Width (m)") as HTMLInputElement).value).toBe("6"); // what was set is still there
    await enter("Width (m)", "8");
    await enter("Height (m)", "3");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const summary = within(step("Your room")!);
    expect(summary.getByText("8 × 5 m, 3 m high")).toBeTruthy();
    expect(summary.queryByText("6 × 5 m, 2.5 m high")).toBeNull(); // the old values are gone
  });

  it("takes away the way forward while a new detection is running or has failed", async () => {
    detect.mockResolvedValueOnce(success).mockResolvedValueOnce({
      ok: false,
      failure: { code: "ai_unavailable", message: "The AI service is not available.", retryable: true },
    });
    const { user, detectFurniture } = setup();
    await detectFurniture();

    await user.click(screen.getByRole("button", { name: "Detect furniture" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("not available"));
    expect(screen.queryByRole("button", { name: "Continue to room size" })).toBeNull();
  });
});

describe("RoomPlanner: correcting the furniture", () => {
  const setupToSummary = async () => {
    const view = setup();
    await view.detectFurniture();
    await view.user.click(screen.getByRole("button", { name: "Continue to room size" }));
    await view.user.click(screen.getByRole("button", { name: "Continue" }));
    return view;
  };
  const summary = (step: (name: string) => HTMLElement | null) => within(step("Your room")!);

  it("starts the list from what the AI found", async () => {
    detect.mockResolvedValue(success);
    const { step } = await setupToSummary();

    expect(summary(step).getByText("Furniture in your room (1)")).toBeTruthy();
    expect(summary(step).getByRole("button", { name: /^Edit Sofa \(200 × 90 × 85 cm\)/ })).toBeTruthy();
  });

  it("keeps the corrections when the user goes back to the room size and returns", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();
    await user.click(summary(step).getByRole("button", { name: /^Remove Sofa/ }));
    await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "bed");
    await user.click(screen.getByRole("button", { name: "Add furniture" }));

    await user.click(screen.getByRole("button", { name: "Back to room size" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(summary(step).getByText("Furniture in your room (1)")).toBeTruthy();
    expect(summary(step).getByRole("button", { name: /^Edit Bed/ })).toBeTruthy();
    expect(summary(step).queryByRole("button", { name: /^Edit Sofa/ })).toBeNull();
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("leaves the AI's own list in the photos step as it was", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();
    await user.click(summary(step).getByRole("button", { name: /^Remove Sofa/ }));

    await user.click(screen.getByRole("button", { name: "Back to room size" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(within(step("Photos")!).getByText("Detected furniture (1)")).toBeTruthy();
  });

  it("starts the list again when the furniture is detected again", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();
    await user.click(summary(step).getByRole("button", { name: /^Remove Sofa/ }));
    expect(summary(step).getByText("Furniture in your room (0)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to room size" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    await user.click(screen.getByRole("button", { name: "Detect furniture" }));
    await user.click(await screen.findByRole("button", { name: "Continue to room size" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(summary(step).getByText("Furniture in your room (1)")).toBeTruthy();
    expect(detect).toHaveBeenCalledTimes(2);
  });
});

/** Furniture detected, the default size confirmed: the "Your room" step is open. */
const setupToSummary = async () => {
  const view = setup();
  await view.detectFurniture();
  await view.user.click(screen.getByRole("button", { name: "Continue to room size" }));
  await view.user.click(screen.getByRole("button", { name: "Continue" }));
  return view;
};
const toThe3dRoom = () => screen.getByRole("button", { name: "Continue to 3D room" });
const the3dView = () => screen.findByRole("group", { name: /^3D view of the room/ });

/** Continues to the 3D room, and waits for its 3D view, which is loaded when the step opens. */
const open3dRoom = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(toThe3dRoom());
  await the3dView();
};

describe("RoomPlanner: the room description", () => {
  const EMPTY_LIST = "The furniture list is empty. Add at least one piece of furniture.";

  const summary = (step: (name: string) => HTMLElement | null) => within(step("Your room")!);

  /** The room description the page shows in the 3D room step, read back from its JSON. */
  const shownDescription = (step: (name: string) => HTMLElement | null) =>
    JSON.parse(
      within(step("3D room")!).getByRole("region", { name: "Room description JSON" }).textContent!,
    );

  const sofa = { label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "grey", material: "fabric" };

  it("makes the room description from the size and the furniture when the user continues", async () => {
    detect.mockResolvedValue(success);
    const { user, step, currentStep, detectFurniture, enter } = setup();
    await detectFurniture();
    await user.click(screen.getByRole("button", { name: "Continue to room size" }));
    await enter("Width (m)", "6");
    await enter("Length (m)", "4,5");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await open3dRoom(user);

    expect(currentStep()).toContain("3D room");
    expect(step("Your room")).toBeNull();
    expect(shownDescription(step)).toEqual({
      room: { width_m: 6, length_m: 4.5, height_m: 2.5 },
      furniture: [sofa],
    });
  });

  it("moves the focus to the 3D room step, since the button that was pressed is gone", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();

    await open3dRoom(user);

    expect(document.activeElement).toBe(step("3D room"));
  });

  it("does not open the 3D room while the furniture list is empty, and says what is missing", async () => {
    detect.mockResolvedValue(success);
    const { user, step, currentStep } = await setupToSummary();
    await user.click(summary(step).getByRole("button", { name: /^Remove Sofa/ }));

    await user.click(toThe3dRoom());

    expect(currentStep()).toContain("Your room");
    expect(step("3D room")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(EMPTY_LIST);
  });

  it("opens the 3D room once the user has added the missing piece, with the typical size for it", async () => {
    detect.mockResolvedValue(success);
    const { user, step, currentStep } = await setupToSummary();
    await user.click(summary(step).getByRole("button", { name: /^Remove Sofa/ }));
    await user.click(toThe3dRoom());
    await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "bed");
    await user.click(screen.getByRole("button", { name: "Add furniture" }));
    expect(screen.queryByRole("alert")).toBeNull();

    await open3dRoom(user);

    expect(currentStep()).toContain("3D room");
    expect(shownDescription(step).furniture).toEqual([
      { label: "bed", width_cm: 140, depth_cm: 200, height_cm: 90, color: "unknown", material: "fabric" },
    ]);
  });

  it("uses the corrections the user made to the list", async () => {
    detect.mockResolvedValue(success);
    const { user, step, enter } = await setupToSummary();
    await user.click(summary(step).getByRole("button", { name: /^Edit Sofa/ }));
    await enter("Width (cm)", "250");
    await enter("Colour", "dark green");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await open3dRoom(user);

    expect(shownDescription(step).furniture).toEqual([{ ...sofa, width_cm: 250, color: "dark green" }]);
  });

  it("replaces the description when the user goes back, changes the furniture and continues again", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();
    await open3dRoom(user);
    expect(shownDescription(step).furniture).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    await user.click(summary(step).getByRole("button", { name: /^Remove Sofa/ }));
    await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "desk");
    await user.click(screen.getByRole("button", { name: "Add furniture" }));
    await open3dRoom(user);

    expect(shownDescription(step).furniture.map((piece: { label: string }) => piece.label)).toEqual(["desk"]);
  });

  it("replaces the size when the user goes back to the room size, changes it and continues again", async () => {
    detect.mockResolvedValue(success);
    const { user, step, enter } = await setupToSummary();
    await open3dRoom(user);
    expect(shownDescription(step).room.width_m).toBe(4);

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    await user.click(screen.getByRole("button", { name: "Back to room size" }));
    await enter("Width (m)", "8");
    await enter("Height (m)", "3");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await open3dRoom(user);

    expect(shownDescription(step).room).toEqual({ width_m: 8, length_m: 5, height_m: 3 });
  });

  it("goes back to the room with the corrections still in place", async () => {
    detect.mockResolvedValue(success);
    const { user, step, currentStep } = await setupToSummary();
    await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "rug");
    await user.click(screen.getByRole("button", { name: "Add furniture" }));
    await open3dRoom(user);

    await user.click(screen.getByRole("button", { name: "Back to your room" }));

    expect(currentStep()).toContain("Your room");
    expect(summary(step).getByText("Furniture in your room (2)")).toBeTruthy();
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("describes the room the user sees: the size shown in the summary is the size in the description", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();
    const shownSize = summary(step).getByText("4 × 5 m, 2.5 m high");

    await open3dRoom(user);

    expect(shownSize).toBeTruthy();
    expect(shownDescription(step).room).toEqual({ width_m: 4, length_m: 5, height_m: 2.5 });
  });
});

describe("RoomPlanner: the 3D room", () => {
  const inThe3dRoom = (step: (name: string) => HTMLElement | null) => within(step("3D room")!);

  it("shows the room in 3D, in the size the user entered", async () => {
    detect.mockResolvedValue(success);
    const { user, enter, detectFurniture } = setup();
    await detectFurniture();
    await user.click(screen.getByRole("button", { name: "Continue to room size" }));
    await enter("Width (m)", "6");
    await enter("Length (m)", "4,5");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await open3dRoom(user);

    const view = screen.getByRole("group", { name: "3D view of the room: 6 m wide, 4.5 m long, 2.5 m high, with 1 piece of furniture" });
    expect(createViewer).toHaveBeenCalledTimes(1);
    expect(createViewer).toHaveBeenCalledWith(view, { width_m: 6, length_m: 4.5, height_m: 2.5 });
  });

  it("says what the 3D room is for: the room and the furniture, to check against the real ones", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();

    await open3dRoom(user);

    expect(inThe3dRoom(step).getByText(/Your room at the size you entered, with your furniture lined up along the back wall/)).toBeTruthy();
    expect(screen.queryByText(/not built yet|Your empty room/)).toBeNull();
  });

  it("says that each piece takes the colour and material found for it, and keeps the model's look when there is none", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();

    await open3dRoom(user);

    expect(inThe3dRoom(step).getByText(/Each piece takes the colour and material found for it; where there is none, the model keeps its own look\./)).toBeTruthy();
  });

  it("puts the furniture of the user's list in the room: the piece the AI found", async () => {
    detect.mockResolvedValue(success);
    const { user } = await setupToSummary();

    await open3dRoom(user);

    expect(viewers[0].showFurniture).toHaveBeenCalledTimes(1);
    const pieces = viewers[0].showFurniture.mock.calls[0][0];
    expect(pieces).toHaveLength(1);
    expect(pieces[0].item).toEqual({ label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "grey", material: "fabric" });
  });

  it("puts the corrections the user made in the room, not what the AI first found", async () => {
    detect.mockResolvedValue(success);
    const { user, step, enter } = await setupToSummary();
    await user.click(within(step("Your room")!).getByRole("button", { name: /^Edit Sofa/ }));
    await enter("Width (cm)", "250");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "bed");
    await user.click(screen.getByRole("button", { name: "Add furniture" }));

    await open3dRoom(user);

    const items = viewers[0].showFurniture.mock.calls[0][0].map((piece: { item: { label: string; width_cm: number } }) => [piece.item.label, piece.item.width_cm]);
    expect(items).toEqual([
      ["sofa", 250],
      ["bed", 140],
    ]);
  });

  it("tells the user which pieces are plain boxes, in the 3D room", async () => {
    detect.mockResolvedValue(success);
    furnitureReport = { count: 1, unmatched: [{ index: 0, type: "sofa", reason: "no-model" }] };
    const { user, step } = await setupToSummary();

    await open3dRoom(user);

    expect(await inThe3dRoom(step).findByText(/1 piece is shown as a plain grey box of its size.*Sofa \(item 1\)/)).toBeTruthy();
  });

  it("shows the changed furniture, in a new viewer, when the user goes back, changes the list and comes again", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();
    await open3dRoom(user);
    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "rug");
    await user.click(screen.getByRole("button", { name: "Add furniture" }));
    expect(within(step("Your room")!).getByText("Furniture in your room (2)")).toBeTruthy();

    await open3dRoom(user);

    expect(viewers).toHaveLength(2);
    expect(viewers[1].showFurniture.mock.calls[0][0].map((piece: { item: { label: string } }) => piece.item.label)).toEqual(["sofa", "rug"]);
  });

  it("does not make the 3D view before the user reaches the 3D room", async () => {
    detect.mockResolvedValue(success);
    await setupToSummary();

    expect(createViewer).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: /^3D view of the room/ })).toBeNull();
  });

  it("keeps the room description off the page until the user reaches the 3D room, and takes it off again when the user goes back", async () => {
    detect.mockResolvedValue(success);
    const { user } = await setupToSummary();
    // Found by text, which also finds what is hidden, so this is about what is on the page and not about what is shown.
    expect(screen.queryByText("Room description (JSON)")).toBeNull();

    await open3dRoom(user);
    expect(screen.getByText("Room description (JSON)")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    expect(screen.queryByText("Room description (JSON)")).toBeNull();
  });

  it("puts the camera back when the user presses Reset view", async () => {
    detect.mockResolvedValue(success);
    const { user } = await setupToSummary();
    await open3dRoom(user);

    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(viewers[0].resetView).toHaveBeenCalledTimes(1);
  });

  it("keeps the room description for checking, folded away below the 3D view", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();
    await open3dRoom(user);

    const panel = inThe3dRoom(step).getByText("Room description (JSON)").closest("details")!;

    expect(panel.open).toBe(false);
    const view = await the3dView();
    expect(view.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("frees the 3D view when the user goes back, and makes a new one for the new size when they continue again", async () => {
    detect.mockResolvedValue(success);
    const { user, enter } = await setupToSummary();
    await open3dRoom(user);
    expect(viewers).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Back to your room" }));

    expect(viewers[0].dispose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: /^3D view of the room/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Back to room size" }));
    await enter("Width (m)", "8");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await open3dRoom(user);

    expect(viewers).toHaveLength(2);
    expect(createViewer).toHaveBeenLastCalledWith(expect.anything(), { width_m: 8, length_m: 5, height_m: 2.5 });
    expect(viewers[1].dispose).not.toHaveBeenCalled();
  });

  it("says so, and still offers the description and the way back, when the browser cannot show 3D", async () => {
    detect.mockResolvedValue(success);
    createViewer.mockImplementation(() => {
      throw new Error("Error creating WebGL context.");
    });
    const { user, step } = await setupToSummary();

    await user.click(toThe3dRoom());

    const alert = await inThe3dRoom(step).findByRole("alert");
    expect(alert.textContent).toContain("The 3D view could not start");
    expect(inThe3dRoom(step).getByRole("region", { name: "Room description JSON" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to your room" })).toBeTruthy();
  });
});

describe("RoomPlanner: the layouts (US-21)", () => {
  const inThe3dRoom = (step: (name: string) => HTMLElement | null) => within(step("3D room")!);
  const generateButton = () => screen.getByRole("button", { name: "Generate layouts" });
  const sofaDescription = {
    room: { width_m: 4, length_m: 5, height_m: 2.5 },
    furniture: [{ label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "grey", material: "fabric" }],
  };

  /** Where a style puts the pieces: each style has its own places and turn, so that a layout can be told from the others and from the rows. */
  const placeFor = (style: LayoutStyle, index: number) =>
    ({
      spacious: { x_m: 1.5 - index, z_m: -1, rotation_deg: 90 },
      cosy: { x_m: -1.5 + index, z_m: 1, rotation_deg: 180 },
      work: { x_m: 0.5, z_m: -1.5 + index, rotation_deg: 270 },
    })[style];
  const styledFor = (style: LayoutStyle, count: number, overrides: Partial<StyledLayout> = {}): StyledLayout => ({
    style,
    ok: true,
    name: STYLE_NAMES[style],
    description: `The idea of the ${STYLE_NAMES[style]} layout.`,
    poses: Array.from({ length: count }, (_, index) => placeFor(style, index)),
    adjusted: [],
    ...overrides,
  });
  const failedStyle = (style: LayoutStyle): StyleFailure => ({
    style,
    ok: false,
    name: STYLE_NAMES[style],
    code: "invalid_answer",
    message: `The AI could not make a usable ${STYLE_NAMES[style]} layout this time.`,
  });
  const layoutsFor = (count: number, failing: LayoutStyle[] = [], calls = { used: 3, limit: 10 }): LayoutOutcome => ({
    ok: true,
    data: { results: LAYOUT_STYLES.map((style) => (failing.includes(style) ? failedStyle(style) : styledFor(style, count))), calls },
  });
  const oneStyle = (style: LayoutStyle, count: number, calls = { used: 4, limit: 10 }): LayoutOutcome => ({ ok: true, data: { results: [styledFor(style, count)], calls } });

  const card = (style: LayoutStyle) => within(screen.getByRole("heading", { name: STYLE_NAMES[style], level: 5 }).closest("li")!);
  const show = (user: ReturnType<typeof userEvent.setup>, style: LayoutStyle) => user.click(card(style).getByRole("button", { name: "Show in the 3D room" }));
  const pressed = (style: LayoutStyle) => card(style).getByRole("button", { name: "Show in the 3D room" }).getAttribute("aria-pressed");
  const showings = (viewer: FakeViewer) => viewer.showFurniture.mock.calls.map(([pieces]) => pieces as { item: { label: string; color: string }; placement: unknown }[]);
  const lastPlaces = (viewer: FakeViewer) => showings(viewer).slice(-1)[0].map((piece) => piece.placement);

  it("is asked for in the 3D room, for the room description that the user confirmed, in all three styles (AC1)", async () => {
    detect.mockResolvedValue(success);
    layoutRequest.mockResolvedValue(layoutsFor(1));
    const { user, step } = await setupToSummary();
    await open3dRoom(user);

    await user.click(generateButton());

    expect(layoutRequest).toHaveBeenCalledTimes(1);
    expect(layoutRequest).toHaveBeenCalledWith(sofaDescription, { styles: undefined, existing: [] });
    expect(await inThe3dRoom(step).findByRole("heading", { name: "Suggested layouts", level: 4 })).toBeTruthy();
    expect(inThe3dRoom(step).getAllByRole("heading", { level: 5 }).map((heading) => heading.textContent)).toEqual(["Spacious", "Cosy", "Work-focused"]);
  });

  it("is not in the other steps", async () => {
    detect.mockResolvedValue(success);
    const { step } = await setupToSummary();

    expect(step("Your room")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate layouts" })).toBeNull();
  });

  describe("shown in the 3D room", () => {
    it("puts the first layout in the 3D room that is open, as soon as the three are made: every piece where it says and turned as it says (AC1)", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue(layoutsFor(1));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      // Until there are layouts the furniture stands in a row, facing the front.
      expect(showings(viewers[0])).toHaveLength(1);
      expect(showings(viewers[0])[0][0].placement).not.toHaveProperty("rotation_deg");

      await user.click(generateButton());
      await inThe3dRoom(step).findByRole("list");

      await waitFor(() => expect(viewers[0].showFurniture).toHaveBeenCalledTimes(2));
      expect(viewers).toHaveLength(1);
      expect(viewers[0].dispose).not.toHaveBeenCalled();
      expect(lastPlaces(viewers[0])).toEqual([{ x_m: 1.5, z_m: -1, rotation_deg: 90 }]);
      expect(pressed("spacious")).toBe("true");
      expect(pressed("cosy")).toBe("false");
      expect(pressed("work")).toBe("false");
    });

    it("says in the 3D room, and in its label, which layout the furniture is in, and says that it is in a row before", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue(layoutsFor(1));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      expect(inThe3dRoom(step).getByText(/with your furniture lined up along the back wall in the order of your list\./)).toBeTruthy();
      expect(screen.queryByRole("group", { name: /layout$/ })).toBeNull();

      await user.click(generateButton());

      expect(await inThe3dRoom(step).findByText(/with your furniture arranged as in the Spacious layout below\. Each piece takes the colour and material/)).toBeTruthy();
      expect(inThe3dRoom(step).queryByText(/lined up along the back wall/)).toBeNull();
      expect(screen.getByRole("group", { name: "3D view of the room: 4 m wide, 5 m long, 2.5 m high, with 1 piece of furniture in the Spacious layout" })).toBeTruthy();
    });

    it("shows another layout in the same 3D room when the user chooses it, without asking the AI again and without making a new view", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue(layoutsFor(1));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await inThe3dRoom(step).findByRole("list");
      await waitFor(() => expect(viewers[0].showFurniture).toHaveBeenCalledTimes(2));

      await show(user, "cosy");

      await waitFor(() => expect(viewers[0].showFurniture).toHaveBeenCalledTimes(3));
      expect(lastPlaces(viewers[0])).toEqual([{ x_m: -1.5, z_m: 1, rotation_deg: 180 }]);
      expect(pressed("cosy")).toBe("true");
      expect(pressed("spacious")).toBe("false");
      expect(screen.getByRole("group", { name: /with 1 piece of furniture in the Cosy layout$/ })).toBeTruthy();
      expect(inThe3dRoom(step).getByText(/arranged as in the Cosy layout below/)).toBeTruthy();
      expect(viewers).toHaveLength(1);
      expect(viewers[0].dispose).not.toHaveBeenCalled();
      expect(layoutRequest).toHaveBeenCalledTimes(1);

      await show(user, "work");
      await waitFor(() => expect(viewers[0].showFurniture).toHaveBeenCalledTimes(4));
      expect(lastPlaces(viewers[0])).toEqual([{ x_m: 0.5, z_m: -1.5, rotation_deg: 270 }]);

      await show(user, "spacious");
      await waitFor(() => expect(viewers[0].showFurniture).toHaveBeenCalledTimes(5));
      expect(lastPlaces(viewers[0])).toEqual([{ x_m: 1.5, z_m: -1, rotation_deg: 90 }]);
    });

    it("shows the first style that worked when the first one did not", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue(layoutsFor(1, ["spacious"]));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);

      await user.click(generateButton());
      await inThe3dRoom(step).findByRole("list");

      await waitFor(() => expect(viewers[0].showFurniture).toHaveBeenCalledTimes(2));
      expect(lastPlaces(viewers[0])).toEqual([{ x_m: -1.5, z_m: 1, rotation_deg: 180 }]);
      expect(pressed("cosy")).toBe("true");
      expect(inThe3dRoom(step).getByText(/arranged as in the Cosy layout below/)).toBeTruthy();
    });

    it("does not change the 3D room when no layout can be made, and the furniture stays in its row", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue({
        ok: false,
        failure: { code: "invalid_answer", message: "The AI could not make a usable layout this time. Please try again.", retryable: true },
      });
      const { user, step } = await setupToSummary();
      await open3dRoom(user);

      await user.click(generateButton());

      await inThe3dRoom(step).findByRole("alert");
      expect(viewers[0].showFurniture).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("group", { name: /layout$/ })).toBeNull();
      expect(inThe3dRoom(step).getByText(/lined up along the back wall/)).toBeTruthy();
    });

    it("shows the first layout of a new set of three, and not the one that was chosen before", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValueOnce(layoutsFor(1)).mockResolvedValueOnce(layoutsFor(1, [], { used: 6, limit: 10 }));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await inThe3dRoom(step).findByRole("list");
      await show(user, "work");
      await waitFor(() => expect(pressed("work")).toBe("true"));

      await user.click(generateButton());

      await waitFor(() => expect(pressed("spacious")).toBe("true"));
      expect(pressed("work")).toBe("false");
      expect(lastPlaces(viewers[0])).toEqual([{ x_m: 1.5, z_m: -1, rotation_deg: 90 }]);
    });

    it("replaces all the layouts when a new set comes, so that a style that the new set has no answer for is not left over from the old", async () => {
      detect.mockResolvedValue(success);
      const twoOnly: LayoutOutcome = { ok: true, data: { results: [styledFor("spacious", 1), failedStyle("cosy")], calls: { used: 6, limit: 10 } } };
      layoutRequest.mockResolvedValueOnce(layoutsFor(1)).mockResolvedValueOnce(twoOnly);
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await inThe3dRoom(step).findByRole("list");
      expect(screen.getByRole("heading", { name: "Work-focused", level: 5 })).toBeTruthy();

      await user.click(generateButton());

      await waitFor(() => expect(screen.queryByRole("heading", { name: "Work-focused", level: 5 })).toBeNull());
      expect(inThe3dRoom(step).getAllByRole("heading", { level: 5 }).map((heading) => heading.textContent)).toEqual(["Spacious", "Cosy"]);
    });

    it("keeps showing the layout that was there when a new set cannot be made", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValueOnce(layoutsFor(1)).mockResolvedValueOnce({ ok: false, failure: { code: "ai_unavailable", message: "Not now.", retryable: true } });
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await inThe3dRoom(step).findByRole("list");
      await show(user, "cosy");
      await waitFor(() => expect(viewers[0].showFurniture).toHaveBeenCalledTimes(3));

      await user.click(generateButton());

      await inThe3dRoom(step).findAllByRole("alert");
      expect(viewers[0].showFurniture).toHaveBeenCalledTimes(3);
      expect(pressed("cosy")).toBe("true");
      expect(screen.getByRole("group", { name: /in the Cosy layout$/ })).toBeTruthy();
    });

    it("shows the layout that was chosen the moment the 3D room is opened again, and never the furniture in a row first (AC1)", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue(layoutsFor(1));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await inThe3dRoom(step).findByRole("list");
      await show(user, "work");
      await waitFor(() => expect(pressed("work")).toBe("true"));
      await user.click(screen.getByRole("button", { name: "Back to your room" }));

      await open3dRoom(user);

      expect(viewers).toHaveLength(2);
      expect(showings(viewers[1])).toHaveLength(1);
      expect(showings(viewers[1])[0][0].placement).toEqual({ x_m: 0.5, z_m: -1.5, rotation_deg: 270 });
      expect(pressed("work")).toBe("true");
    });

    it("shows layouts that were still being made when the user went back, as soon as the user comes to the 3D room again", async () => {
      detect.mockResolvedValue(success);
      let finish!: (outcome: LayoutOutcome) => void;
      layoutRequest.mockReturnValue(new Promise<LayoutOutcome>((resolve) => (finish = resolve)));
      const { user } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await user.click(screen.getByRole("button", { name: "Back to your room" }));
      await act(async () => finish(layoutsFor(1)));

      await open3dRoom(user);

      expect(showings(viewers[1])).toHaveLength(1);
      expect(showings(viewers[1])[0][0].placement).toEqual({ x_m: 1.5, z_m: -1, rotation_deg: 90 });
    });

    it("keeps the layouts, and the one that is shown, when only the colour of a piece has changed, with the new colour on the piece", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue(layoutsFor(1));
      const { user, step, enter } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await inThe3dRoom(step).findByRole("list");
      await show(user, "cosy");
      await waitFor(() => expect(pressed("cosy")).toBe("true"));
      await user.click(screen.getByRole("button", { name: "Back to your room" }));
      await user.click(within(step("Your room")!).getByRole("button", { name: /^Edit Sofa/ }));
      await enter("Colour", "dark green");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await open3dRoom(user);

      const [first] = showings(viewers[1]);
      expect(first[0].item.color).toBe("dark green");
      expect(first[0].placement).toEqual({ x_m: -1.5, z_m: 1, rotation_deg: 180 });
      expect(pressed("cosy")).toBe("true");
      expect(layoutRequest).toHaveBeenCalledTimes(1);
    });

    it("does not show layouts for other furniture: when the list changes the furniture stands in a row again, until layouts are made for it", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue(layoutsFor(1));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await inThe3dRoom(step).findByRole("list");
      await user.click(screen.getByRole("button", { name: "Back to your room" }));
      await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "rug");
      await user.click(screen.getByRole("button", { name: "Add furniture" }));

      await open3dRoom(user);

      expect(showings(viewers[1])).toHaveLength(1);
      expect(showings(viewers[1])[0]).toHaveLength(2);
      for (const piece of showings(viewers[1])[0]) expect(piece.placement).not.toHaveProperty("rotation_deg");
      expect(screen.queryByRole("group", { name: /layout$/ })).toBeNull();
      expect(inThe3dRoom(step).getByText(/lined up along the back wall/)).toBeTruthy();
      expect(inThe3dRoom(step).queryByRole("list")).toBeNull();
    });

    it("does not show layouts that come in late for furniture that has changed since they were asked for", async () => {
      detect.mockResolvedValue(success);
      let finish!: (outcome: LayoutOutcome) => void;
      layoutRequest.mockReturnValue(new Promise<LayoutOutcome>((resolve) => (finish = resolve)));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await user.click(screen.getByRole("button", { name: "Back to your room" }));
      await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "rug");
      await user.click(screen.getByRole("button", { name: "Add furniture" }));
      await open3dRoom(user);

      // The answer is for a list of one piece, and the list now has two.
      await act(async () => finish(layoutsFor(1)));

      expect(inThe3dRoom(step).queryByRole("list")).toBeNull();
      expect(inThe3dRoom(step).queryByRole("table")).toBeNull();
      expect(viewers[1].showFurniture).toHaveBeenCalledTimes(1);
      expect(showings(viewers[1])[0]).toHaveLength(2);
      for (const piece of showings(viewers[1])[0]) expect(piece.placement).not.toHaveProperty("rotation_deg");
      // The button is free to ask for the new list.
      expect(generateButton().hasAttribute("disabled")).toBe(false);
    });

    it("still lists the layouts when the browser cannot show 3D, and does not fail", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue(layoutsFor(1));
      createViewer.mockImplementation(() => {
        throw new Error("Error creating WebGL context.");
      });
      const { user, step } = await setupToSummary();
      await user.click(toThe3dRoom());
      await inThe3dRoom(step).findByRole("alert");

      await user.click(generateButton());

      expect(await inThe3dRoom(step).findByRole("list")).toBeTruthy();
      expect(inThe3dRoom(step).getAllByRole("table")).toHaveLength(3);
      expect(inThe3dRoom(step).getByText(/The 3D view could not start/)).toBeTruthy();
    });
  });

  describe("a style that fails while the others work (AC4)", () => {
    it("shows the other two, a message for the failed one, and shows the first that worked in the 3D room", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValue(layoutsFor(1, ["cosy"], { used: 4, limit: 10 }));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);

      await user.click(generateButton());

      expect(await card("cosy").findByText("The AI could not make a usable Cosy layout this time.")).toBeTruthy();
      expect(card("cosy").getByRole("button", { name: "Try again" })).toBeTruthy();
      expect(card("spacious").getByRole("table")).toBeTruthy();
      expect(card("work").getByRole("table")).toBeTruthy();
      expect(pressed("spacious")).toBe("true");
      expect(inThe3dRoom(step).getByText("AI calls used this session: 4 of 10")).toBeTruthy();
    });

    it("makes only that style again, told the layouts that worked, and puts the new layout in its card without changing what the 3D room shows", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValueOnce(layoutsFor(1, ["cosy"], { used: 4, limit: 10 })).mockResolvedValueOnce(oneStyle("cosy", 1, { used: 5, limit: 10 }));
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await card("cosy").findByRole("button", { name: "Try again" });
      await show(user, "work");
      await waitFor(() => expect(pressed("work")).toBe("true"));
      const showingsBefore = viewers[0].showFurniture.mock.calls.length;

      await user.click(card("cosy").getByRole("button", { name: "Try again" }));

      expect(await card("cosy").findByRole("table")).toBeTruthy();
      expect(layoutRequest).toHaveBeenLastCalledWith(sofaDescription, {
        styles: ["cosy"],
        existing: [
          { style: "spacious", poses: [placeFor("spacious", 0)] },
          { style: "work", poses: [placeFor("work", 0)] },
        ],
      });
      // The 3D room still shows the layout that the user chose, and was not drawn again.
      expect(pressed("work")).toBe("true");
      expect(pressed("cosy")).toBe("false");
      expect(viewers[0].showFurniture).toHaveBeenCalledTimes(showingsBefore);
      expect(inThe3dRoom(step).getByText("AI calls used this session: 5 of 10")).toBeTruthy();
      expect(inThe3dRoom(step).queryByText("The AI could not make a usable Cosy layout this time.")).toBeNull();
    });

    it("can then show the layout that was made again", async () => {
      detect.mockResolvedValue(success);
      layoutRequest.mockResolvedValueOnce(layoutsFor(1, ["cosy"])).mockResolvedValueOnce(oneStyle("cosy", 1));
      const { user } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await user.click(await card("cosy").findByRole("button", { name: "Try again" }));
      await card("cosy").findByRole("table");

      await show(user, "cosy");

      await waitFor(() => expect(lastPlaces(viewers[0])).toEqual([{ x_m: -1.5, z_m: 1, rotation_deg: 180 }]));
    });

    it("keeps the message, and keeps the other layouts, when making the style again fails too", async () => {
      detect.mockResolvedValue(success);
      layoutRequest
        .mockResolvedValueOnce(layoutsFor(1, ["cosy"]))
        .mockResolvedValueOnce({ ok: false, failure: { code: "ai_unavailable", message: "The AI service is not available right now. Please try again in a moment.", retryable: true, calls: { used: 5, limit: 10 } } });
      const { user, step } = await setupToSummary();
      await open3dRoom(user);
      await user.click(generateButton());
      await user.click(await card("cosy").findByRole("button", { name: "Try again" }));

      expect(await inThe3dRoom(step).findByText("The AI service is not available right now. Please try again in a moment.")).toBeTruthy();
      expect(card("cosy").getByText("The AI could not make a usable Cosy layout this time.")).toBeTruthy();
      expect(card("spacious").getByRole("table")).toBeTruthy();
      expect(pressed("spacious")).toBe("true");
    });
  });

  it("leaves the 3D room as it is when no layout can be made, and says why (AC3 of US-19)", async () => {
    detect.mockResolvedValue(success);
    layoutRequest.mockResolvedValue({
      ok: false,
      failure: { code: "invalid_answer", message: "The AI could not make a usable layout this time. Please try again.", retryable: true, calls: { used: 6, limit: 10 } },
    });
    const { user, step } = await setupToSummary();
    await open3dRoom(user);
    const showingCount = viewers[0].showFurniture.mock.calls.length;

    await user.click(generateButton());

    expect((await inThe3dRoom(step).findByRole("alert")).textContent).toContain("The AI could not make a usable layout this time.");
    expect(viewers).toHaveLength(1);
    expect(viewers[0].dispose).not.toHaveBeenCalled();
    expect(viewers[0].showFurniture).toHaveBeenCalledTimes(showingCount);
    expect(screen.getByRole("group", { name: /^3D view of the room/ })).toBeTruthy();
  });

  it("keeps the layouts when the user goes back to the room and continues again without changing anything", async () => {
    detect.mockResolvedValue(success);
    layoutRequest.mockResolvedValue(layoutsFor(1));
    const { user, step } = await setupToSummary();
    await open3dRoom(user);
    await user.click(generateButton());
    await inThe3dRoom(step).findByRole("list");

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    expect(screen.queryByRole("table")).toBeNull(); // the 3D room is hidden
    await open3dRoom(user);

    expect(inThe3dRoom(step).getAllByRole("table")).toHaveLength(3);
    expect(layoutRequest).toHaveBeenCalledTimes(1);
  });

  it("does not lose layouts that are still being made when the user goes back, and shows them when they return", async () => {
    detect.mockResolvedValue(success);
    let finish!: (outcome: LayoutOutcome) => void;
    layoutRequest.mockReturnValue(new Promise<LayoutOutcome>((resolve) => (finish = resolve)));
    const { user, step } = await setupToSummary();
    await open3dRoom(user);
    await user.click(generateButton());

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    finish(layoutsFor(1));
    await open3dRoom(user);

    expect(await inThe3dRoom(step).findByRole("list")).toBeTruthy();
    expect(layoutRequest).toHaveBeenCalledTimes(1);
  });

  it("forgets the layouts when the furniture has changed, as they are layouts of other furniture", async () => {
    detect.mockResolvedValue(success);
    layoutRequest.mockResolvedValue(layoutsFor(1));
    const { user, step } = await setupToSummary();
    await open3dRoom(user);
    await user.click(generateButton());
    await inThe3dRoom(step).findByRole("list");

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "rug");
    await user.click(screen.getByRole("button", { name: "Add furniture" }));
    await open3dRoom(user);

    expect(inThe3dRoom(step).queryByRole("table")).toBeNull();
    layoutRequest.mockResolvedValue(layoutsFor(2));
    await user.click(generateButton());
    expect(layoutRequest).toHaveBeenLastCalledWith(expect.objectContaining({ furniture: expect.arrayContaining([expect.objectContaining({ label: "rug" })]) }), { styles: undefined, existing: [] });
    expect(await inThe3dRoom(step).findAllByRole("row")).toHaveLength(3 * 3);
  });

  it("keeps the layouts when only the colour, the material or the height of a piece has changed, which a layout does not depend on", async () => {
    detect.mockResolvedValue(success);
    layoutRequest.mockResolvedValue(layoutsFor(1));
    const { user, step, enter } = await setupToSummary();
    await open3dRoom(user);
    await user.click(generateButton());
    await inThe3dRoom(step).findByRole("list");

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    await user.click(within(step("Your room")!).getByRole("button", { name: /^Edit Sofa/ }));
    await enter("Colour", "dark green");
    await enter("Height (cm)", "70");
    await user.selectOptions(screen.getByLabelText("Material"), "leather");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await open3dRoom(user);

    expect(inThe3dRoom(step).getAllByRole("table")).toHaveLength(3);
    expect(layoutRequest).toHaveBeenCalledTimes(1);
  });

  it("forgets the layouts when the size of a piece has changed", async () => {
    detect.mockResolvedValue(success);
    layoutRequest.mockResolvedValue(layoutsFor(1));
    const { user, step, enter } = await setupToSummary();
    await open3dRoom(user);
    await user.click(generateButton());
    await inThe3dRoom(step).findByRole("list");

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    await user.click(within(step("Your room")!).getByRole("button", { name: /^Edit Sofa/ }));
    await enter("Width (cm)", "250");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await open3dRoom(user);

    expect(inThe3dRoom(step).queryByRole("table")).toBeNull();
    expect(inThe3dRoom(step).queryByRole("list")).toBeNull();
  });

  it("keeps the layouts when only the height of the room has changed", async () => {
    detect.mockResolvedValue(success);
    layoutRequest.mockResolvedValue(layoutsFor(1));
    const { user, step, enter } = await setupToSummary();
    await open3dRoom(user);
    await user.click(generateButton());
    await inThe3dRoom(step).findByRole("list");

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    await user.click(screen.getByRole("button", { name: "Back to room size" }));
    await enter("Height (m)", "3.2");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await open3dRoom(user);

    expect(inThe3dRoom(step).getAllByRole("table")).toHaveLength(3);
    expect(layoutRequest).toHaveBeenCalledTimes(1);
  });

  it("forgets the layouts when the size of the room has changed", async () => {
    detect.mockResolvedValue(success);
    layoutRequest.mockResolvedValue(layoutsFor(1));
    const { user, step, enter } = await setupToSummary();
    await open3dRoom(user);
    await user.click(generateButton());
    await inThe3dRoom(step).findByRole("list");

    await user.click(screen.getByRole("button", { name: "Back to your room" }));
    await user.click(screen.getByRole("button", { name: "Back to room size" }));
    await enter("Width (m)", "8");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await open3dRoom(user);

    expect(inThe3dRoom(step).queryByRole("table")).toBeNull();
    expect(inThe3dRoom(step).queryByRole("list")).toBeNull();
  });
});
