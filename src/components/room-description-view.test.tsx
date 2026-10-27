// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { FurnitureItem } from "../shared/furniture";
import { createRoomDescription, parseRoomDescription, type RoomDescription } from "../shared/room-description";
import { RoomDescriptionView } from "./room-description-view";

afterEach(cleanup);

const sofa: FurnitureItem = { label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "dark grey", material: "fabric" };
const rug: FurnitureItem = { label: "rug", width_cm: 160, depth_cm: 230, height_cm: 1, color: "beige", material: "fabric" };

function makeDescription(furniture: FurnitureItem[], room = { width_m: 4, length_m: 5.5, height_m: 2.5 }): RoomDescription {
  const result = createRoomDescription(room, furniture);
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.description;
}

const jsonShown = () => screen.getByRole("region", { name: "Room description JSON" }).textContent ?? "";

describe("RoomDescriptionView", () => {
  it("shows the room description as JSON that loads back into the same description", () => {
    const description = makeDescription([sofa, rug]);

    render(<RoomDescriptionView description={description} />);

    const loaded = parseRoomDescription(JSON.parse(jsonShown()));
    expect(loaded).toEqual({ ok: true, description });
  });

  it("shows the JSON indented, so it can be read", () => {
    render(<RoomDescriptionView description={makeDescription([sofa])} />);

    expect(jsonShown()).toBe(JSON.stringify(makeDescription([sofa]), null, 2));
    expect(jsonShown()).toContain('\n  "room": {\n    "width_m": 4,');
  });

  it("says in a sentence what the room is and how many pieces it has", () => {
    render(<RoomDescriptionView description={makeDescription([sofa, rug])} />);

    expect(screen.getByText(/4 × 5\.5 m, 2\.5 m\s+high, with 2 pieces of furniture\./)).toBeTruthy();
  });

  it("says 1 piece, not 1 pieces", () => {
    render(<RoomDescriptionView description={makeDescription([sofa])} />);

    expect(screen.getByText(/with 1 piece of furniture\./)).toBeTruthy();
  });

  it("is folded away at first, so that it does not take the place of the 3D room, and opens with a click", async () => {
    const { container } = render(<RoomDescriptionView description={makeDescription([sofa])} />);

    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Room description (JSON)");

    await userEvent.setup().click(screen.getByText("Room description (JSON)"));

    expect(details.open).toBe(true);
  });

  it("can be reached with the keyboard, since the JSON may be longer than the box", () => {
    render(<RoomDescriptionView description={makeDescription([sofa])} />);

    expect(screen.getByRole("region", { name: "Room description JSON" }).tabIndex).toBe(0);
  });

  it("keeps every character of a colour that has quotes and non-latin letters", () => {
    const awkward = { ...sofa, color: 'warm "oak" / сив 🛋' };

    render(<RoomDescriptionView description={makeDescription([awkward])} />);

    expect(JSON.parse(jsonShown()).furniture[0].color).toBe('warm "oak" / сив 🛋');
  });
});
