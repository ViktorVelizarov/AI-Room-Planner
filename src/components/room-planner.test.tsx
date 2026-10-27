// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectOutcome } from "../client/detect-client";
import { requestDetection } from "../client/detect-client";
import { createRoomViewer, type RoomViewer } from "../viewer";
import { RoomPlanner } from "./room-planner";

vi.mock("../client/detect-client", () => ({ requestDetection: vi.fn() }));
const detect = vi.mocked(requestDetection);

// The 3D view needs WebGL, which jsdom does not have, so the viewer is replaced by one that records what it is asked.
vi.mock("../viewer", () => ({ createRoomViewer: vi.fn() }));
const createViewer = vi.mocked(createRoomViewer);
type FakeViewer = { resetView: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
let viewers: FakeViewer[];

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: (file: Blob) => `blob:preview/${(file as File).name}`,
    revokeObjectURL: vi.fn(),
  });
  viewers = [];
  createViewer.mockImplementation(() => {
    const viewer: FakeViewer = { resetView: vi.fn(), move: vi.fn(), dispose: vi.fn() };
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

  it("shows the empty room in 3D, in the size the user entered", async () => {
    detect.mockResolvedValue(success);
    const { user, enter, detectFurniture } = setup();
    await detectFurniture();
    await user.click(screen.getByRole("button", { name: "Continue to room size" }));
    await enter("Width (m)", "6");
    await enter("Length (m)", "4,5");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await open3dRoom(user);

    const view = screen.getByRole("group", { name: "3D view of the room: 6 m wide, 4.5 m long, 2.5 m high" });
    expect(createViewer).toHaveBeenCalledTimes(1);
    expect(createViewer).toHaveBeenCalledWith(view, { width_m: 6, length_m: 4.5, height_m: 2.5 });
  });

  it("says what the 3D room is for, and no longer says that it is not built yet", async () => {
    detect.mockResolvedValue(success);
    const { user, step } = await setupToSummary();

    await open3dRoom(user);

    expect(inThe3dRoom(step).getByText(/Your empty room at the size you entered/)).toBeTruthy();
    expect(screen.queryByText(/not built yet/)).toBeNull();
  });

  it("does not make the 3D view before the user reaches the 3D room", async () => {
    detect.mockResolvedValue(success);
    await setupToSummary();

    expect(createViewer).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: /^3D view of the room/ })).toBeNull();
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
