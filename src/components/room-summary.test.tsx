// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FurnitureItem } from "../shared/furniture";
import { toEntries, type FurnitureEntry } from "../shared/furniture-list";
import type { RoomSize } from "../shared/room";
import type { RoomDescription } from "../shared/room-description";
import { RoomSummary } from "./room-summary";

afterEach(cleanup);

const size: RoomSize = { width_m: 6, length_m: 4.5, height_m: 2.5 };
const sofa: FurnitureItem = { label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "grey", material: "fabric" };
const desk: FurnitureItem = { label: "desk", width_cm: 120, depth_cm: 60, height_cm: 75, color: "oak brown", material: "wood" };

const EMPTY_LIST = "The furniture list is empty. Add at least one piece of furniture.";

/** The summary is controlled, so this keeps the list the way the page does. */
function Harness({
  initial,
  roomSize,
  onConfirm,
}: {
  initial: FurnitureItem[];
  roomSize: RoomSize;
  onConfirm: (description: RoomDescription) => void;
}) {
  const [entries, setEntries] = useState<FurnitureEntry[]>(toEntries(initial));
  return (
    <RoomSummary
      size={roomSize}
      entries={entries}
      unsupported={0}
      onEntriesChange={setEntries}
      onBack={() => {}}
      onConfirm={onConfirm}
    />
  );
}

const setup = (initial: FurnitureItem[], roomSize: RoomSize = size) => {
  const onConfirm = vi.fn<(description: RoomDescription) => void>();
  render(<Harness initial={initial} roomSize={roomSize} onConfirm={onConfirm} />);
  const user = userEvent.setup();
  const next = () => user.click(screen.getByRole("button", { name: "Continue to 3D room" }));
  const addPiece = async (type: string) => {
    await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), type);
    await user.click(screen.getByRole("button", { name: "Add furniture" }));
  };
  const removeAll = async () => {
    for (const button of screen.queryAllByRole("button", { name: /^Remove / })) await user.click(button);
  };
  return { user, onConfirm, next, addPiece, removeAll };
};

describe("RoomSummary: continuing", () => {
  it("hands on the room description, made of the room size and every piece, when it is complete", async () => {
    const { onConfirm, next } = setup([sofa, desk]);

    await next();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ room: size, furniture: [sofa, desk] });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("makes the description from the list as the user corrected it", async () => {
    const { onConfirm, next, addPiece, user } = setup([sofa, desk]);
    await user.click(screen.getByRole("button", { name: /^Remove Sofa/ }));
    await addPiece("bed");

    await next();

    const [description] = onConfirm.mock.lastCall!;
    expect(description.furniture.map((piece) => piece.label)).toEqual(["desk", "bed"]);
    expect(description.furniture[1]).toMatchObject({ width_cm: 140, depth_cm: 200, color: "unknown" });
  });

  it("does not say anything is missing before Continue is pressed", () => {
    setup([]);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not continue with an empty furniture list, and says what is missing", async () => {
    const { onConfirm, next } = setup([]);

    await next();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(EMPTY_LIST);
  });

  it("does not continue after the last piece was removed", async () => {
    const { onConfirm, next, removeAll } = setup([sofa]);
    await removeAll();

    await next();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(EMPTY_LIST);
  });

  it("takes the message away once the list has a piece, and then continues", async () => {
    const { onConfirm, next, addPiece } = setup([]);
    await next();
    expect(screen.getByRole("alert")).toBeTruthy();

    await addPiece("sofa");

    expect(screen.queryByRole("alert")).toBeNull();
    await next();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows the message again, as a new message, each time Continue is pressed without a fix", async () => {
    const { next } = setup([]);
    await next();
    const first = screen.getByRole("alert");

    await next();

    const second = screen.getByRole("alert");
    expect(second.textContent).toBe(EMPTY_LIST);
    expect(second).not.toBe(first); // a new element, which a screen reader reads out again
  });

  it("starts over after a successful Continue: emptying the list again shows nothing until Continue is pressed", async () => {
    const { next, addPiece, removeAll } = setup([]);
    await next(); // fails
    await addPiece("sofa");
    await next(); // succeeds

    await removeAll();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The size form never lets a size like this through; this checks that the step still refuses it.
  const tooHigh: RoomSize = { ...size, height_m: 9 };
  const TOO_HIGH = "The room height must be at most 5 m (it is 9 m).";

  it("says which size is wrong, if the room size is not valid", async () => {
    const { onConfirm, next } = setup([sofa], tooHigh);

    await next();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(TOO_HIGH);
  });

  it("says every problem, each in its own line, when there is more than one", async () => {
    const { next } = setup([], tooHigh);

    await next();

    const lines = [...screen.getByRole("alert").querySelectorAll("p")].map((p) => p.textContent);
    expect(lines).toEqual([TOO_HIGH, EMPTY_LIST]);
  });
});
