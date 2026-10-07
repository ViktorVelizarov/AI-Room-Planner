// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FURNITURE_LABELS,
  FURNITURE_NAMES,
  TYPICAL_ITEMS,
  type FurnitureItem,
} from "../shared/furniture";
import { toEntries, toItems, type FurnitureEntry } from "../shared/furniture-list";
import { FurnitureEditor } from "./furniture-editor";

afterEach(cleanup);

const sofa: FurnitureItem = { label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "grey", material: "fabric" };
const desk: FurnitureItem = { label: "desk", width_cm: 120, depth_cm: 60, height_cm: 75, color: "oak brown", material: "wood" };
const rug: FurnitureItem = { label: "rug", width_cm: 200, depth_cm: 300, height_cm: 2, color: "beige", material: "fabric" };

/** The editor is controlled, so this keeps the list the way the page does. */
function Harness({
  initial,
  unsupported = 0,
  onChange,
}: {
  initial: FurnitureItem[];
  unsupported?: number;
  onChange: (items: FurnitureItem[]) => void;
}) {
  const [entries, setEntries] = useState<FurnitureEntry[]>(toEntries(initial));
  return (
    <FurnitureEditor
      entries={entries}
      unsupported={unsupported}
      onChange={(next) => {
        setEntries(next);
        onChange(toItems(next));
      }}
    />
  );
}

const setup = (initial: FurnitureItem[], unsupported = 0) => {
  const onChange = vi.fn<(items: FurnitureItem[]) => void>();
  render(<Harness initial={initial} unsupported={unsupported} onChange={onChange} />);
  const user = userEvent.setup();
  /** The list the page now holds: the last one the editor reported. */
  const current = () => onChange.mock.lastCall?.[0];
  const rows = () => screen.queryAllByRole("listitem").map((li) => li.textContent);
  const heading = () => screen.getByRole("heading", { level: 3 });
  const editButton = (name: RegExp | string) => screen.getByRole("button", { name: typeof name === "string" ? new RegExp(`^Edit ${name}`) : name });
  const removeButton = (name: RegExp | string) => screen.getByRole("button", { name: typeof name === "string" ? new RegExp(`^Remove ${name}`) : name });
  const addPiece = async (type: string) => {
    await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), type);
    await user.click(screen.getByRole("button", { name: "Add furniture" }));
  };
  /** Replaces what is in a box, like pasting. */
  const enter = async (label: string, value: string) => {
    const field = screen.getByLabelText(label);
    await user.clear(field);
    if (value) {
      await user.click(field);
      await user.paste(value);
    }
  };
  return { user, onChange, current, rows, heading, editButton, removeButton, addPiece, enter };
};

describe("FurnitureEditor", () => {
  describe("the list", () => {
    it("shows each piece with its type, size, colour and material", () => {
      setup([sofa, desk]);

      expect(screen.getByText("Furniture in your room (2)")).toBeTruthy();
      expect(screen.getByText("200 × 90 × 85 cm")).toBeTruthy();
      expect(screen.getByText("grey · fabric")).toBeTruthy();
      expect(screen.getByText("120 × 60 × 75 cm")).toBeTruthy();
      expect(screen.getByText("oak brown · wood")).toBeTruthy();
    });

    it("says how many unsupported things were left out", () => {
      setup([sofa], 2);

      expect(screen.getByText("2 other items are not supported furniture types and were left out.")).toBeTruthy();
    });

    it("says there is no furniture when the list is empty", () => {
      setup([]);

      expect(screen.getByText(/There is no furniture in the list/)).toBeTruthy();
      expect(screen.getByText("Furniture in your room (0)")).toBeTruthy();
    });
  });

  describe("AC1: removing a piece that is wrong or a duplicate", () => {
    it("takes it out of the list and out of what is used for the room", async () => {
      const { user, current, removeButton, rows } = setup([sofa, desk, rug]);

      await user.click(removeButton("Desk"));

      expect(rows().some((row) => row?.includes("Desk"))).toBe(false);
      expect(rows()).toHaveLength(2);
      expect(screen.getByText("Furniture in your room (2)")).toBeTruthy();
      expect(current()).toEqual([sofa, rug]);
    });

    it("removes only the duplicate that was chosen", async () => {
      const bigSofa = { ...sofa, width_cm: 260 };
      const { user, current } = setup([sofa, bigSofa]);

      await user.click(screen.getByRole("button", { name: "Remove Sofa (260 × 90 × 85 cm)" }));

      expect(current()).toEqual([sofa]);
    });

    it("moves the focus to the heading, since the button that was pressed is gone", async () => {
      const { user, removeButton, heading } = setup([sofa, desk]);

      await user.click(removeButton("Sofa"));

      expect(document.activeElement).toBe(heading());
    });

    it("tells screen reader users what happened", async () => {
      const { user, removeButton } = setup([sofa]);

      await user.click(removeButton("Sofa"));

      expect(screen.getByRole("status").textContent).toBe("Removed Sofa.");
    });

    it("can empty the list", async () => {
      const { user, current, removeButton } = setup([sofa]);

      await user.click(removeButton("Sofa"));

      expect(current()).toEqual([]);
      expect(screen.getByText(/There is no furniture in the list/)).toBeTruthy();
    });
  });

  describe("AC2: adding a piece the AI missed", () => {
    it("cannot be pressed until a type is chosen", async () => {
      const { user } = setup([sofa]);
      const add = screen.getByRole("button", { name: "Add furniture" }) as HTMLButtonElement;
      expect(add.disabled).toBe(true);

      await user.selectOptions(screen.getByLabelText("Add a piece the AI missed"), "desk");

      expect(add.disabled).toBe(false);
    });

    it("adds the type with its typical size at the end, and clears the choice", async () => {
      const { current, addPiece } = setup([sofa]);

      await addPiece("desk");

      expect(screen.getByText("Furniture in your room (2)")).toBeTruthy();
      expect(current()?.[1]).toMatchObject({ label: "desk", width_cm: 120, depth_cm: 60, height_cm: 75 });
      expect(screen.getByText("120 × 60 × 75 cm")).toBeTruthy();
      expect(screen.getByText("unknown · wood")).toBeTruthy();
      expect((screen.getByLabelText("Add a piece the AI missed") as HTMLSelectElement).value).toBe("");
      expect((screen.getByRole("button", { name: "Add furniture" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it.each(FURNITURE_LABELS)("%s: can be added, with its typical size", async (label) => {
      const { current, addPiece } = setup([]);

      await addPiece(label);

      const { width_cm, depth_cm, height_cm } = TYPICAL_ITEMS[label];
      expect(current()).toEqual([expect.objectContaining({ label, width_cm, depth_cm, height_cm })]);
      expect(screen.getByRole("button", { name: new RegExp(`^Edit ${FURNITURE_NAMES[label]} `) })).toBeTruthy();
    });

    it("can add the same type twice", async () => {
      const { current, addPiece } = setup([]);

      await addPiece("dining_chair");
      await addPiece("dining_chair");

      expect(current()).toHaveLength(2);
    });

    it("tells screen reader users what happened", async () => {
      const { addPiece } = setup([]);

      await addPiece("rug");

      expect(screen.getByRole("status").textContent).toBe("Added Rug with a typical size.");
    });
  });

  describe("AC3: changing the type of a piece", () => {
    it("shows the new type and keeps the size, colour and material", async () => {
      const { user, current, editButton } = setup([sofa, desk]);
      await user.click(editButton("Sofa"));

      await user.selectOptions(screen.getByLabelText("Type"), "armchair");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(current()).toEqual([{ ...sofa, label: "armchair" }, desk]);
      expect(screen.getByRole("button", { name: /^Edit Armchair \(200 × 90 × 85 cm\)/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Edit Sofa/ })).toBeNull();
      expect(screen.getByText("grey · fabric")).toBeTruthy();
    });

    it("offers all 15 supported types", async () => {
      const { user, editButton } = setup([sofa]);
      await user.click(editButton("Sofa"));

      const options = within(screen.getByLabelText("Type")).getAllByRole("option").map((o) => o.getAttribute("value"));

      expect(options).toEqual([...FURNITURE_LABELS]);
    });
  });

  describe("AC4: correcting the size of a piece", () => {
    it("replaces the old size with the new one", async () => {
      const { user, current, editButton, enter } = setup([sofa, desk]);
      await user.click(editButton("Sofa"));

      await enter("Width (cm)", "250");
      await enter("Depth (cm)", "100,5"); // a decimal comma
      await enter("Height (cm)", "80");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(current()).toEqual([{ ...sofa, width_cm: 250, depth_cm: 100.5, height_cm: 80 }, desk]);
      expect(screen.getByText("250 × 101 × 80 cm")).toBeTruthy(); // shown to the nearest cm
      expect(screen.queryByText("200 × 90 × 85 cm")).toBeNull();
    });

    it("can also change the colour and the material", async () => {
      const { user, current, editButton, enter } = setup([sofa]);
      await user.click(editButton("Sofa"));

      await enter("Colour", "  teal blue ");
      await user.selectOptions(screen.getByLabelText("Material"), "leather");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(current()).toEqual([{ ...sofa, color: "teal blue", material: "leather" }]);
      expect(screen.getByText("teal blue · leather")).toBeTruthy();
    });

    it("starts with what the piece has now", async () => {
      const { user, editButton } = setup([{ ...sofa, width_cm: 199.6, depth_cm: 90.25 }]);

      await user.click(editButton("Sofa"));

      expect((screen.getByLabelText("Width (cm)") as HTMLInputElement).value).toBe("199.6");
      expect((screen.getByLabelText("Depth (cm)") as HTMLInputElement).value).toBe("90.3");
      expect((screen.getByLabelText("Height (cm)") as HTMLInputElement).value).toBe("85");
      expect((screen.getByLabelText("Colour") as HTMLInputElement).value).toBe("grey");
      expect((screen.getByLabelText("Material") as HTMLSelectElement).value).toBe("fabric");
    });

    it("puts the focus back on the piece's Edit button after saving", async () => {
      const { user, editButton } = setup([sofa, desk]);
      await user.click(editButton("Desk"));

      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(document.activeElement).toBe(editButton("Desk"));
    });
  });

  describe("a value that is not acceptable", () => {
    it.each([
      ["Width (cm)", "", "Enter the width in cm."],
      ["Depth (cm)", "wide", "Depth must be a number, for example 85."],
      ["Height (cm)", "0", "Height must be between 1 and 1000 cm."],
      ["Width (cm)", "5000", "Width must be between 1 and 1000 cm."],
      ["Colour", "   ", "Enter a colour, for example grey."],
    ])("%s = %j: shows a message next to the box and does not save", async (label, value, message) => {
      const { user, onChange, editButton, enter } = setup([sofa]);
      await user.click(editButton("Sofa"));
      await enter(label, value);

      await user.click(screen.getByRole("button", { name: "Save" }));

      const field = screen.getByLabelText(label);
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById(field.getAttribute("aria-describedby")!)?.textContent).toBe(message);
      expect(document.activeElement).toBe(field);
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole("form", { name: "Edit Sofa" })).toBeTruthy(); // still open
    });

    it("shows every wrong box at once and focuses the first", async () => {
      const { user, editButton, enter } = setup([sofa]);
      await user.click(editButton("Sofa"));
      await enter("Depth (cm)", "abc");
      await enter("Height (cm)", "");

      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByText("Depth must be a number, for example 85.")).toBeTruthy();
      expect(screen.getByText("Enter the height in cm.")).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByLabelText("Depth (cm)"));
    });

    it("saves once the values are fixed", async () => {
      const { user, current, editButton, enter } = setup([sofa]);
      await user.click(editButton("Sofa"));
      await enter("Width (cm)", "abc");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await enter("Width (cm)", "220");
      expect(screen.queryByText(/Width must be/)).toBeNull();
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(current()).toEqual([{ ...sofa, width_cm: 220 }]);
    });
  });

  describe("cancelling", () => {
    it("throws the changes away and keeps the piece as it was", async () => {
      const { user, onChange, editButton, enter } = setup([sofa]);
      await user.click(editButton("Sofa"));
      await enter("Width (cm)", "999");
      await user.selectOptions(screen.getByLabelText("Type"), "bed");

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("form")).toBeNull();
      expect(screen.getByText("200 × 90 × 85 cm")).toBeTruthy();
      expect(document.activeElement).toBe(editButton("Sofa"));
    });
  });

  describe("editing one piece at a time", () => {
    it("closes the open form when another piece is edited", async () => {
      const { user, editButton } = setup([sofa, desk]);
      await user.click(editButton("Sofa"));

      await user.click(editButton("Desk"));

      expect(screen.getAllByRole("form")).toHaveLength(1);
      expect(screen.getByRole("form", { name: "Edit Desk" })).toBeTruthy();
    });

    it("leaves the open form alone when another piece is removed", async () => {
      const { user, editButton, removeButton, enter } = setup([sofa, desk]);
      await user.click(editButton("Sofa"));
      await enter("Width (cm)", "250");

      await user.click(removeButton("Desk"));

      expect(screen.getByRole("form", { name: "Edit Sofa" })).toBeTruthy();
      expect((screen.getByLabelText("Width (cm)") as HTMLInputElement).value).toBe("250"); // what was typed is still there
    });
  });
});
