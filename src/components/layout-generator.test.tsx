// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayoutFailure, LayoutOutcome } from "../client/layout-client";
import { requestLayout } from "../client/layout-client";
import type { LayoutResponse } from "../shared/api";
import { typicalItem, type FurnitureItem } from "../shared/furniture";
import type { Pose } from "../shared/layout";
import type { RoomDescription } from "../shared/room-description";
import { LayoutGenerator } from "./layout-generator";

vi.mock("../client/layout-client", () => ({ requestLayout: vi.fn() }));
const request = vi.mocked(requestLayout);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const sofa: FurnitureItem = { ...typicalItem("sofa"), width_cm: 200, depth_cm: 90 };
const table: FurnitureItem = { ...typicalItem("coffee_table"), width_cm: 100, depth_cm: 60 };
const stand: FurnitureItem = { ...typicalItem("tv_stand"), width_cm: 140, depth_cm: 40 };
const room = { width_m: 5, length_m: 4, height_m: 2.5 };
const description = { room, furniture: [sofa, table, stand] };

const poses: Pose[] = [
  { x_m: 0, z_m: 1.45, rotation_deg: 180 },
  { x_m: -0.5, z_m: 0.35, rotation_deg: 0 },
  { x_m: 0, z_m: -1.8, rotation_deg: 0 },
];

const success = (layout: Pose[] = poses, adjusted: number[] = [], calls = { used: 1, limit: 10 }): LayoutOutcome => ({
  ok: true,
  data: { layout, adjusted, calls },
});

const failure = (overrides: Partial<LayoutFailure> = {}): LayoutOutcome => ({
  ok: false,
  failure: {
    code: "ai_unavailable",
    message: "The AI service is not available right now. Please try again in a moment.",
    retryable: true,
    ...overrides,
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** What the 3D room step is to the generator: it holds the layout, and is told of each one that is made. */
const reported: LayoutResponse[] = [];
function Holder({ shown, first = null }: { shown: RoomDescription; first?: LayoutResponse | null }) {
  const [layout, setLayout] = useState<LayoutResponse | null>(first);
  return (
    <LayoutGenerator
      description={shown}
      layout={layout}
      onLayout={(made) => {
        reported.push(made);
        setLayout(made);
      }}
    />
  );
}

const setup = (shown = description, first: LayoutResponse | null = null) => {
  reported.length = 0;
  render(<Holder shown={shown} first={first} />);
  const user = userEvent.setup();
  const button = () => screen.getByRole("button", { name: /Generate layout|Generating/ }) as HTMLButtonElement;
  return { user, button };
};

const error = () => screen.queryByRole("alert")?.textContent ?? null;
const rows = () => screen.queryAllByRole("row").slice(1).map((row) => row.textContent);

describe("LayoutGenerator", () => {
  describe("the Generate layout button (AC1)", () => {
    it("is there for a room description, with what it does and what it costs, and no layout yet", () => {
      const { button } = setup();

      expect(screen.getByRole("heading", { name: "Suggest a layout" })).toBeTruthy();
      expect(screen.getByText(/It uses one AI call, or two if the first answer cannot be used\./)).toBeTruthy();
      expect(button().disabled).toBe(false);
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByText(/AI calls used this session/)).toBeNull();
      expect(request).not.toHaveBeenCalled();
    });

    it("asks for a layout of the room description, once, when it is clicked", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(description);
    });

    it("lists where every piece goes, in the order of the list, by name and place in it, with the position and the way it faces", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());

      expect(await screen.findByRole("heading", { name: "Suggested layout" })).toBeTruthy();
      expect(rows()).toEqual([
        "Sofa (item 1)x 0.00, z 1.45the back wall",
        "Coffee table (item 2)x -0.50, z 0.35the front wall",
        "TV stand (item 3)x 0.00, z -1.80the front wall",
      ]);
      expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Piece", "Position (m)", "Faces"]);
    });

    it("writes positions with two decimals, and never as -0.00, and says an angle between two walls", async () => {
      request.mockResolvedValue(
        success([
          { x_m: -0.001, z_m: 1.006, rotation_deg: 45 },
          { x_m: 2.4999, z_m: -0.004, rotation_deg: 270 },
          { x_m: 0, z_m: 0, rotation_deg: 90 },
        ]),
      );
      const { user, button } = setup();

      await user.click(button());

      await screen.findByRole("table");
      expect(rows()).toEqual([
        "Sofa (item 1)x 0.00, z 1.01between the front wall and the right wall",
        "Coffee table (item 2)x 2.50, z 0.00the left wall",
        "TV stand (item 3)x 0.00, z 0.00the right wall",
      ]);
    });

    it("explains what the numbers mean", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());

      expect(await screen.findByText(/A position is the middle of the piece, in metres from the middle of the room: x towards the right wall and z towards the front wall/)).toBeTruthy();
    });
  });

  describe("while the layout is being made (AC4)", () => {
    it("shows a loading indicator, locks the button, and then the layout", async () => {
      const pending = deferred<LayoutOutcome>();
      request.mockReturnValue(pending.promise);
      const { user, button } = setup();

      await user.click(button());

      expect(screen.getByRole("status").textContent).toMatch(/Asking the AI for a layout/);
      expect(button().textContent).toBe("Generating…");
      expect(button().disabled).toBe(true);
      expect(button().querySelector('span[aria-hidden="true"]')).not.toBeNull(); // the spinning ring, which is hidden from screen readers

      pending.resolve(success());

      await screen.findByRole("table");
      expect(screen.queryByRole("status")).toBeNull();
      expect(button().querySelector("span")).toBeNull();
      expect(button().textContent).toBe("Generate layout");
      expect(button().disabled).toBe(false);
    });

    it("does not ask twice when the button is pressed again before the answer is back", async () => {
      const pending = deferred<LayoutOutcome>();
      request.mockReturnValue(pending.promise);
      const { user, button } = setup();

      await user.click(button());
      await user.click(button());

      expect(request).toHaveBeenCalledTimes(1);
    });

    it("says how many of the AI calls of the session have been used, from what the server said", async () => {
      request.mockResolvedValue(success(poses, [], { used: 3, limit: 10 }));
      const { user, button } = setup();

      await user.click(button());

      expect((await screen.findByText(/AI calls used this session/)).textContent).toBe("AI calls used this session: 3 of 10");
    });
  });

  describe("pieces that the app moved", () => {
    it("says which, by name and place in the list, so that the user knows it is not exactly what the AI said", async () => {
      request.mockResolvedValue(success(poses, [1, 2]));
      const { user, button } = setup();

      await user.click(button());

      expect(await screen.findByText(/2 pieces were adjusted a little by the app, so that nothing overlaps or goes through a wall: Coffee table \(item 2\), TV stand \(item 3\)\./)).toBeTruthy();
    });

    it("says it right for one piece", async () => {
      request.mockResolvedValue(success(poses, [0]));
      const { user, button } = setup();

      await user.click(button());

      expect(await screen.findByText(/^1 piece was adjusted a little by the app, so that nothing overlaps or goes through a wall: Sofa \(item 1\)\.$/)).toBeTruthy();
    });

    it("says nothing about it when no piece was moved", async () => {
      request.mockResolvedValue(success(poses, []));
      const { user, button } = setup();

      await user.click(button());

      await screen.findByRole("table");
      expect(screen.queryByText(/adjusted a little by the app/)).toBeNull();
    });
  });

  describe("when it fails (AC3)", () => {
    it("shows the message in an alert, and offers to try again when that can help", async () => {
      request.mockResolvedValue(failure());
      const { user, button } = setup();

      await user.click(button());

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(error()).toContain("The AI service is not available right now. Please try again in a moment.");
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
      expect(screen.queryByRole("table")).toBeNull();
      expect(button().disabled).toBe(false);
    });

    it("asks again when the user chooses to try again, and clears the error when that works", async () => {
      request.mockResolvedValueOnce(failure()).mockResolvedValueOnce(success());
      const { user, button } = setup();
      await user.click(button());

      await user.click(await screen.findByRole("button", { name: "Try again" }));

      expect(await screen.findByRole("table")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
    });

    it("does not offer to try again when it would not help, such as for a session that is used up", async () => {
      request.mockResolvedValue(
        failure({ code: "limit_reached", message: "You have used all 10 AI calls for this session.", retryable: false, calls: { used: 10, limit: 10 } }),
      );
      const { user, button } = setup();

      await user.click(button());

      expect(await screen.findByText("You have used all 10 AI calls for this session.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(screen.getByText("AI calls used this session: 10 of 10")).toBeTruthy();
    });

    it("keeps the layout that was there, and the room as it is, when a new one fails", async () => {
      request.mockResolvedValueOnce(success()).mockResolvedValueOnce(failure({ message: "The AI could not make a usable layout this time. Please try again." }));
      const { user, button } = setup();
      await user.click(button());
      await screen.findByRole("table");

      await user.click(button());

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(rows()).toHaveLength(3);
      expect(screen.getByRole("heading", { name: "Suggested layout" })).toBeTruthy();
    });

    it("replaces the layout when a new one is made, and shows the count of the new answer", async () => {
      const other: Pose[] = [
        { x_m: 1, z_m: 1, rotation_deg: 0 },
        { x_m: 2, z_m: 2, rotation_deg: 90 },
        { x_m: 3, z_m: -1, rotation_deg: 180 },
      ];
      request.mockResolvedValueOnce(success(poses, [], { used: 1, limit: 10 })).mockResolvedValueOnce(success(other, [], { used: 2, limit: 10 }));
      const { user, button } = setup();
      await user.click(button());
      await screen.findByRole("table");

      await user.click(button());

      expect(await screen.findByText("AI calls used this session: 2 of 10")).toBeTruthy();
      expect(rows()[0]).toBe("Sofa (item 1)x 1.00, z 1.00the front wall");
    });

    it("shows the error and not the loading indicator once the call is over", async () => {
      request.mockResolvedValue(failure());
      const { user, button } = setup();

      await user.click(button());

      await screen.findByRole("alert");
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  describe("a room that cannot hold its furniture", () => {
    // Six sofas of 1.8 m2 on 12 m2: 90% of the floor.
    const full = { room: { ...room, width_m: 4, length_m: 3 }, furniture: Array.from({ length: 6 }, () => sofa) };

    it("says why, and does not offer a layout, without asking the AI", async () => {
      const { user, button } = setup(full);

      expect(screen.getByText(/^Your furniture would cover 90% of the floor, which leaves no room for a layout without overlaps\./)).toBeTruthy();
      expect(button().disabled).toBe(true);
      await user.click(button());
      expect(request).not.toHaveBeenCalled();
    });

    it("says only that, and does not warn about a full floor, when a piece is bigger than the room", () => {
      // A piece 1 m x 2.6 m on a floor of 2 m x 2 m is bigger than the room, and covers 65% of the floor, which is in the range where a warning would be given.
      setup({ room: { ...room, width_m: 2, length_m: 2 }, furniture: [{ ...sofa, width_cm: 100, depth_cm: 260 }] });

      expect(screen.getByText(/^Sofa \(item 1\) is bigger than the room/)).toBeTruthy();
      expect(screen.queryByText(/may not be possible/)).toBeNull();
    });

    it("names a piece that is bigger than the room", () => {
      setup({ room: { ...room, width_m: 1.5, length_m: 1.5 }, furniture: [table, sofa] });

      expect(screen.getByText(/^Sofa \(item 2\) is bigger than the room/)).toBeTruthy();
    });
  });

  describe("a room that is very full", () => {
    // 4 m x 2.5 m = 10 m2; ten tables of 0.6 m2 cover 60%.
    const crowded = { room: { ...room, width_m: 4, length_m: 2.5 }, furniture: Array.from({ length: 10 }, () => table) };

    it("warns that a layout may not be possible, and still lets the user ask", async () => {
      request.mockResolvedValue(success(Array.from({ length: 10 }, () => poses[0])));
      const { user, button } = setup(crowded);

      expect(screen.getByText("Your furniture covers about 60% of the floor, so a layout without overlaps may not be possible.")).toBeTruthy();
      expect(button().disabled).toBe(false);
      await user.click(button());
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("has no warning for a room with plenty of floor", () => {
      setup();

      expect(screen.queryByText(/may not be possible/)).toBeNull();
    });
  });

  it("puts the table in a box that scrolls if it must, so that a narrow screen never makes the page scroll", async () => {
    request.mockResolvedValue(success());
    const { user, button } = setup();

    await user.click(button());

    const table = await screen.findByRole("table");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(3);
  });

  it("says that the 3D room above shows the layout, so that nobody has to look for it, and says nothing of the kind before there is one (US-20)", async () => {
    request.mockResolvedValue(success());
    const { user, button } = setup();

    expect(screen.queryByText(/The 3D room above shows this layout/)).toBeNull();
    await user.click(button());

    expect(await screen.findByText("The 3D room above shows this layout: look around it to judge how the furniture stands.")).toBeTruthy();
    expect(screen.queryByText(/does not show this layout yet|still shows your furniture in a row/)).toBeNull();
  });
});

describe("LayoutGenerator: the layout belongs to its parent (US-20)", () => {
  it("tells its parent about every layout that is made, with the poses, the pieces that were moved and the calls, so that the 3D room can show it", async () => {
    const other: Pose[] = [
      { x_m: 1, z_m: 1, rotation_deg: 0 },
      { x_m: 2, z_m: 2, rotation_deg: 90 },
      { x_m: 3, z_m: -1, rotation_deg: 180 },
    ];
    request.mockResolvedValueOnce(success(poses, [1], { used: 1, limit: 10 })).mockResolvedValueOnce(success(other, [], { used: 2, limit: 10 }));
    const { user, button } = setup();
    expect(reported).toEqual([]);

    await user.click(button());
    await screen.findByRole("table");
    await user.click(button());
    await screen.findByText("AI calls used this session: 2 of 10");

    expect(reported).toEqual([
      { layout: poses, adjusted: [1], calls: { used: 1, limit: 10 } },
      { layout: other, adjusted: [], calls: { used: 2, limit: 10 } },
    ]);
  });

  it("does not tell its parent anything when the layout cannot be made, so that the layout and the 3D room that were there stay", async () => {
    request.mockResolvedValue(failure());
    const { user, button } = setup();

    await user.click(button());

    await screen.findByRole("alert");
    expect(reported).toEqual([]);
  });

  it("does not tell its parent while a layout is still being made", async () => {
    request.mockReturnValue(deferred<LayoutOutcome>().promise);
    const { user, button } = setup();

    await user.click(button());

    expect(reported).toEqual([]);
  });

  it("shows the layout that its parent gives it, as soon as it is there, and the count of calls only once it has made one itself", () => {
    setup(description, { layout: poses, adjusted: [2], calls: { used: 4, limit: 10 } });

    expect(rows()).toEqual([
      "Sofa (item 1)x 0.00, z 1.45the back wall",
      "Coffee table (item 2)x -0.50, z 0.35the front wall",
      "TV stand (item 3)x 0.00, z -1.80the front wall",
    ]);
    expect(screen.getByText(/1 piece was adjusted a little by the app/)).toBeTruthy();
    expect(screen.getByText(/The 3D room above shows this layout/)).toBeTruthy();
    expect(screen.queryByText(/AI calls used this session/)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("shows nothing about a layout when its parent has none", () => {
    setup();

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/The 3D room above shows this layout/)).toBeNull();
  });

  it("goes on showing the layout its parent holds when asking for another fails, and asks again from it", async () => {
    request.mockResolvedValueOnce(failure({ message: "The AI could not make a usable layout this time. Please try again." })).mockResolvedValueOnce(success());
    const { user } = setup(description, { layout: poses, adjusted: [], calls: { used: 1, limit: 10 } });

    await user.click(screen.getByRole("button", { name: "Generate layout" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(rows()).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("AI calls used this session: 1 of 10");
    expect(reported).toHaveLength(1);
  });
});
