// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitRoom } from "./room-outline";
import { RoomSizeForm } from "./room-size-form";

afterEach(cleanup);

const setup = () => {
  const onBack = vi.fn();
  const onConfirm = vi.fn();
  const { container } = render(<RoomSizeForm onBack={onBack} onConfirm={onConfirm} />);
  const user = userEvent.setup();
  const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  /** Replaces what is in a field in one go, like pasting. */
  const enter = async (label: string, value: string) => {
    const input = field(label);
    await user.clear(input);
    if (value) {
      await user.click(input);
      await user.paste(value);
    }
  };
  const outline = () => screen.getByRole("img", { name: /Top-down outline/ });
  const outlineRect = () => {
    const rect = container.querySelector("svg rect")!;
    return { width: Number(rect.getAttribute("width")), height: Number(rect.getAttribute("height")) };
  };
  const continueButton = () => screen.getByRole("button", { name: "Continue" });
  return { user, onBack, onConfirm, field, enter, outline, outlineRect, continueButton };
};

describe("RoomSizeForm", () => {
  describe("the fields", () => {
    it("has width, length and height in metres, filled with sensible defaults", () => {
      const { field } = setup();

      expect(field("Width (m)").value).toBe("4");
      expect(field("Length (m)").value).toBe("5");
      expect(field("Height (m)").value).toBe("2.5");
    });

    it("can be continued straight away with the defaults", async () => {
      const { user, onConfirm, continueButton } = setup();

      await user.click(continueButton());

      expect(onConfirm).toHaveBeenCalledWith({ width_m: 4, length_m: 5, height_m: 2.5 });
    });

    it("hands over what was typed, as numbers, and understands a decimal comma", async () => {
      const { user, onConfirm, enter, continueButton } = setup();
      await enter("Width (m)", "6,5");
      await enter("Length (m)", "12");
      await enter("Height (m)", "3.2");

      await user.click(continueButton());

      expect(onConfirm).toHaveBeenCalledWith({ width_m: 6.5, length_m: 12, height_m: 3.2 });
    });

    it("goes back without confirming anything", async () => {
      const { user, onBack, onConfirm } = setup();

      await user.click(screen.getByRole("button", { name: "Back" }));

      expect(onBack).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("the top-down outline", () => {
    it("starts with the default size", () => {
      const { outline } = setup();

      expect(outline().getAttribute("aria-label")).toBe(
        "Top-down outline of the room, 4 metres wide and 5 metres long",
      );
    });

    it("follows the width and the length as they are changed", async () => {
      const { enter, outline, outlineRect } = setup();

      await enter("Width (m)", "8");
      expect(outline().getAttribute("aria-label")).toContain("8 metres wide and 5 metres long");
      expect(outlineRect().width / outlineRect().height).toBeCloseTo(8 / 5, 3);

      await enter("Length (m)", "2");
      expect(outline().getAttribute("aria-label")).toContain("8 metres wide and 2 metres long");
      expect(outlineRect().width / outlineRect().height).toBeCloseTo(8 / 2, 3);
    });

    it("shows the ceiling height", async () => {
      const { enter } = setup();
      expect(screen.getByText("Seen from above. Ceiling height 2.5 m.")).toBeTruthy();

      await enter("Height (m)", "3,2");

      expect(screen.getByText("Seen from above. Ceiling height 3.2 m.")).toBeTruthy();
    });

    it("keeps the last valid size while a field holds something unusable", async () => {
      const { enter, outline } = setup();
      await enter("Width (m)", "7");

      await enter("Width (m)", "25"); // out of range
      expect(outline().getAttribute("aria-label")).toContain("7 metres wide");
      await enter("Width (m)", "abc"); // not a number
      expect(outline().getAttribute("aria-label")).toContain("7 metres wide");
      await enter("Width (m)", ""); // empty
      expect(outline().getAttribute("aria-label")).toContain("7 metres wide");
    });
  });

  describe("a value that is not acceptable", () => {
    it.each([
      ["Width (m)", "", "Enter the width in metres."],
      ["Length (m)", "   ", "Enter the length in metres."],
      ["Height (m)", "", "Enter the height in metres."],
      ["Width (m)", "abc", "Width must be a number, for example 4.5."],
      ["Height (m)", "2 m", "Height must be a number, for example 4.5."],
      ["Width (m)", "0.5", "Width must be between 1 and 20 m."],
      ["Width (m)", "21", "Width must be between 1 and 20 m."],
      ["Length (m)", "25", "Length must be between 1 and 20 m."],
      ["Height (m)", "1.5", "Height must be between 2 and 5 m."],
      ["Height (m)", "6", "Height must be between 2 and 5 m."],
    ])("%s = %j: shows a message next to the field and does not continue", async (label, value, message) => {
      const { user, onConfirm, field, enter, continueButton } = setup();
      await enter(label, value);

      await user.click(continueButton());

      const input = field(label);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const described = document.getElementById(input.getAttribute("aria-describedby")!);
      expect(described?.textContent).toBe(message);
      expect(document.activeElement).toBe(input);
    });

    it("shows a message for every field that is wrong, and focuses the first one", async () => {
      const { user, onConfirm, field, enter, continueButton } = setup();
      await enter("Length (m)", "abc");
      await enter("Height (m)", "9");

      await user.click(continueButton());

      expect(screen.getByText("Length must be a number, for example 4.5.")).toBeTruthy();
      expect(screen.getByText("Height must be between 2 and 5 m.")).toBeTruthy();
      expect(field("Width (m)").getAttribute("aria-invalid")).toBeNull(); // this one is fine
      expect(document.activeElement).toBe(field("Length (m)"));
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("cannot be continued until every field is fixed, then can", async () => {
      const { user, onConfirm, field, enter, continueButton } = setup();
      await enter("Width (m)", "50");
      await user.click(continueButton());
      expect(onConfirm).not.toHaveBeenCalled();

      await enter("Width (m)", "9");
      expect(screen.queryByText(/Width must be/)).toBeNull(); // the message goes as soon as it is fixed
      expect(field("Width (m)").getAttribute("aria-invalid")).toBeNull();
      await user.click(continueButton());

      expect(onConfirm).toHaveBeenCalledWith({ width_m: 9, length_m: 5, height_m: 2.5 });
    });

    it("shows the message when the user leaves the field, before they press Continue", async () => {
      const { user, enter } = setup();
      await enter("Width (m)", "abc");
      expect(screen.queryByText(/Width must be a number/)).toBeNull(); // not while they are still on it

      await user.tab();

      expect(screen.getByText("Width must be a number, for example 4.5.")).toBeTruthy();
    });

    it("does not nag about a field the user has not touched", () => {
      setup();

      expect(screen.queryByText(/must be|Enter the/)).toBeNull();
    });
  });
});

describe("fitRoom", () => {
  it.each([
    [4, 5],
    [20, 1],
    [1, 20],
    [3, 3],
    [10, 2],
  ])("draws a %i × %i m room with its proportions, centred, inside the drawing", (width, length) => {
    const room = fitRoom(width, length);

    expect(room.width / room.height).toBeCloseTo(width / length, 6);
    expect(room.x).toBeGreaterThanOrEqual(44); // room left for the labels
    expect(room.y).toBeGreaterThanOrEqual(40);
    expect(room.x + room.width).toBeLessThanOrEqual(320 - 44 + 1e-9);
    expect(room.y + room.height).toBeLessThanOrEqual(240 - 40 + 1e-9);
    expect(room.x + room.width / 2).toBeCloseTo(160, 6);
    expect(room.y + room.height / 2).toBeCloseTo(120, 6);
  });

  it("fills the drawing in one direction", () => {
    const room = fitRoom(4, 5);

    const fillsWidth = Math.abs(room.width - (320 - 88)) < 1e-6;
    const fillsHeight = Math.abs(room.height - (240 - 80)) < 1e-6;
    expect(fillsWidth || fillsHeight).toBe(true);
  });
});
