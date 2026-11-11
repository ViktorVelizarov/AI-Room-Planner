// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayoutFailure, LayoutOutcome } from "../client/layout-client";
import { requestLayout } from "../client/layout-client";
import type { StyledLayout, StyleFailure, StyleFailureCode, StyleResult } from "../shared/api";
import { typicalItem, type FurnitureItem } from "../shared/furniture";
import type { Pose } from "../shared/layout";
import { LAYOUT_STYLES, STYLE_NAMES, type LayoutStyle } from "../shared/layout-styles";
import type { RoomDescription } from "../shared/room-description";
import { LayoutGenerator, type LayoutResults } from "./layout-generator";

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

// A different layout of the three pieces for each style, so that the cards can be told apart.
const POSES: Record<LayoutStyle, Pose[]> = {
  spacious: [
    { x_m: 0, z_m: 1.45, rotation_deg: 180 },
    { x_m: -0.5, z_m: 0.35, rotation_deg: 0 },
    { x_m: 0, z_m: -1.8, rotation_deg: 0 },
  ],
  cosy: [
    { x_m: -1, z_m: 0.25, rotation_deg: 90 },
    { x_m: 0.2, z_m: 0.25, rotation_deg: 0 },
    { x_m: 1.9, z_m: 0, rotation_deg: 270 },
  ],
  work: [
    { x_m: 1.5, z_m: 1, rotation_deg: 270 },
    { x_m: -0.5, z_m: 1.2, rotation_deg: 0 },
    { x_m: -1.8, z_m: -1.6, rotation_deg: 0 },
  ],
};
const madeOf = (style: LayoutStyle, overrides: Partial<StyledLayout> = {}): StyledLayout => ({
  style,
  ok: true,
  name: STYLE_NAMES[style],
  description: `The idea of the ${STYLE_NAMES[style]} layout.`,
  poses: POSES[style],
  adjusted: [],
  ...overrides,
});
const failedOf = (style: LayoutStyle, code: StyleFailureCode = "invalid_answer", message = `The AI could not make a usable ${STYLE_NAMES[style]} layout this time.`): StyleFailure => ({
  style,
  ok: false,
  name: STYLE_NAMES[style],
  code,
  message,
});
const three = () => LAYOUT_STYLES.map((style) => madeOf(style));

const success = (results: StyleResult[] = three(), calls = { used: 3, limit: 10 }): LayoutOutcome => ({ ok: true, data: { results, calls } });
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

const firstOk = (made: StyleResult[]) => LAYOUT_STYLES.find((style) => made.some((result) => result.style === style && result.ok)) ?? null;

/** What the 3D room step is to the box: it holds the layouts and which one is shown, and is told of each answer. */
const reported: { made: StyleResult[]; replaceAll: boolean }[] = [];
const shownByUser: LayoutStyle[] = [];
function Holder({ shown: room3d, first = {}, firstShown = null }: { shown: RoomDescription; first?: LayoutResults; firstShown?: LayoutStyle | null }) {
  const [results, setResults] = useState<LayoutResults>(first);
  const [shown, setShown] = useState<LayoutStyle | null>(firstShown);
  return (
    <LayoutGenerator
      description={room3d}
      results={results}
      shown={shown}
      onResults={(made, replaceAll) => {
        reported.push({ made, replaceAll });
        setResults((previous) => ({ ...(replaceAll ? {} : previous), ...Object.fromEntries(made.map((result) => [result.style, result])) }));
        setShown((previous) => (replaceAll ? firstOk(made) : (previous ?? firstOk(made))));
      }}
      onShow={(style) => {
        shownByUser.push(style);
        setShown(style);
      }}
    />
  );
}

const setup = (shown = description, first: LayoutResults = {}, firstShown: LayoutStyle | null = null) => {
  reported.length = 0;
  shownByUser.length = 0;
  render(<Holder shown={shown} first={first} firstShown={firstShown} />);
  const user = userEvent.setup();
  const button = () => screen.getByRole("button", { name: /Generate layouts|Generating/ }) as HTMLButtonElement;
  return { user, button };
};

const alreadyMade = (...results: StyleResult[]): LayoutResults => Object.fromEntries(results.map((result) => [result.style, result]));

/** The card of a style: the list item that has its name as a heading. */
const card = (style: LayoutStyle) => within(screen.getByRole("heading", { name: STYLE_NAMES[style], level: 5 }).closest("li")!);
const names = () => screen.queryAllByRole("heading", { level: 5 }).map((heading) => heading.textContent);
const error = () => screen.queryAllByRole("alert").map((alert) => alert.textContent);
const rowsOf = (style: LayoutStyle) => card(style).queryAllByRole("row").slice(1).map((row) => row.textContent);

describe("LayoutGenerator", () => {
  describe("the Generate layouts button (AC1)", () => {
    it("is there for a room description, with what it does and what it costs, and no layouts yet", () => {
      const { button } = setup();

      expect(screen.getByRole("heading", { name: "Suggest layouts" })).toBeTruthy();
      expect(screen.getByText(/in three styles: Spacious, Cosy and Work-focused\. It uses three AI calls, or more if an answer cannot be used\./)).toBeTruthy();
      expect(button().disabled).toBe(false);
      expect(screen.queryByRole("list")).toBeNull();
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByText(/AI calls used this session/)).toBeNull();
      expect(request).not.toHaveBeenCalled();
    });

    it("asks for the layouts of the room description, in all three styles, once, when it is clicked", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(description, { styles: undefined, existing: [] });
    });

    it("shows a card for each style, in the order of the styles: its name, and the idea of the layout (AC2)", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());

      expect(await screen.findByRole("heading", { name: "Suggested layouts", level: 4 })).toBeTruthy();
      expect(names()).toEqual(["Spacious", "Cosy", "Work-focused"]);
      expect(card("spacious").getByText("The idea of the Spacious layout.")).toBeTruthy();
      expect(card("cosy").getByText("The idea of the Cosy layout.")).toBeTruthy();
      expect(card("work").getByText("The idea of the Work-focused layout.")).toBeTruthy();
      expect(screen.getAllByRole("listitem")).toHaveLength(3);
    });

    it("tells its parent about the answer, for a new set of three, so that the 3D room can show one", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());
      await screen.findByRole("list");

      expect(reported).toEqual([{ made: three(), replaceAll: true }]);
    });

    it("lists where every piece goes in each layout, in the order of the list, by name and place in it, with the position and the way it faces", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());
      await screen.findByRole("list");

      expect(rowsOf("spacious")).toEqual([
        "Sofa (item 1)x 0.00, z 1.45the back wall",
        "Coffee table (item 2)x -0.50, z 0.35the front wall",
        "TV stand (item 3)x 0.00, z -1.80the front wall",
      ]);
      expect(rowsOf("cosy")).toEqual([
        "Sofa (item 1)x -1.00, z 0.25the right wall",
        "Coffee table (item 2)x 0.20, z 0.25the front wall",
        "TV stand (item 3)x 1.90, z 0.00the left wall",
      ]);
      expect(rowsOf("work")[0]).toBe("Sofa (item 1)x 1.50, z 1.00the left wall");
      expect(card("spacious").getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Piece", "Position (m)", "Faces"]);
    });

    it("keeps each table folded away until it is opened, so that three layouts do not make a page of numbers, and names it for a screen reader", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());
      await screen.findByRole("list");

      const details = card("cosy").getByText("Where each piece goes").closest("details")!;
      expect(details.open).toBe(false);
      expect(within(details).getByRole("table", { name: "Where each piece goes in the Cosy layout" })).toBeTruthy();
    });

    it("writes positions with two decimals, and never as -0.00, and says an angle between two walls", async () => {
      request.mockResolvedValue(
        success([
          madeOf("spacious", {
            poses: [
              { x_m: -0.001, z_m: 1.006, rotation_deg: 45 },
              { x_m: 2.4999, z_m: -0.004, rotation_deg: 270 },
              { x_m: 0, z_m: 0, rotation_deg: 90 },
            ],
          }),
          madeOf("cosy"),
          madeOf("work"),
        ]),
      );
      const { user, button } = setup();

      await user.click(button());

      await screen.findByRole("list");
      expect(rowsOf("spacious")).toEqual([
        "Sofa (item 1)x 0.00, z 1.01between the front wall and the right wall",
        "Coffee table (item 2)x 2.50, z 0.00the left wall",
        "TV stand (item 3)x 0.00, z 0.00the right wall",
      ]);
    });

    it("explains what the numbers mean, once, and says that the 3D room shows the layout that was chosen", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());

      expect(await screen.findAllByText(/A position is the middle of the piece, in metres from the middle of the room: x towards the right wall and z towards the front wall/)).toHaveLength(1);
      expect(screen.getAllByText(/The 3D room above shows the layout that you chose with Show in the 3D room/)).toHaveLength(1);
    });

    it("says nothing about the 3D room before there are layouts", () => {
      setup();

      expect(screen.queryByText(/The 3D room above shows/)).toBeNull();
      expect(screen.queryByText(/A position is the middle/)).toBeNull();
    });

    it("puts the table in a box that scrolls if it must, so that a narrow screen never makes the page scroll", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());
      await screen.findByRole("list");

      const spacious = card("spacious").getByRole("table");
      expect(spacious.parentElement?.className).toContain("overflow-x-auto");
      expect(within(spacious).getAllByRole("rowheader")).toHaveLength(3);
    });
  });

  describe("while the layouts are made", () => {
    it("shows a loading indicator, locks the button, and then the layouts", async () => {
      const pending = deferred<LayoutOutcome>();
      request.mockReturnValue(pending.promise);
      const { user, button } = setup();

      await user.click(button());

      expect(screen.getByRole("status").textContent).toBe("Asking the AI for three layouts. This can take a minute or two.");
      expect(button().textContent).toBe("Generating…");
      expect(button().disabled).toBe(true);
      expect(button().querySelector('span[aria-hidden="true"]')).not.toBeNull(); // the spinning ring, which is hidden from screen readers

      pending.resolve(success());

      await screen.findByRole("list");
      expect(screen.queryByRole("status")).toBeNull();
      expect(button().querySelector("span")).toBeNull();
      expect(button().textContent).toBe("Generate layouts");
      expect(button().disabled).toBe(false);
    });

    it("does not ask twice when the button is pressed again before the answer is back", async () => {
      request.mockReturnValue(deferred<LayoutOutcome>().promise);
      const { user, button } = setup();

      await user.click(button());
      await user.click(button());

      expect(request).toHaveBeenCalledTimes(1);
    });

    it("says how many of the AI calls of the session have been used, from what the server said", async () => {
      request.mockResolvedValue(success(three(), { used: 5, limit: 10 }));
      const { user, button } = setup();

      await user.click(button());

      expect((await screen.findByText(/AI calls used this session/)).textContent).toBe("AI calls used this session: 5 of 10");
    });

    it("keeps the layouts that are there while new ones are asked for, and replaces them with the new three", async () => {
      const pending = deferred<LayoutOutcome>();
      request.mockReturnValue(pending.promise);
      const { user, button } = setup(description, alreadyMade(...three()), "spacious");

      await user.click(button());
      expect(names()).toEqual(["Spacious", "Cosy", "Work-focused"]);

      pending.resolve(success([madeOf("spacious", { description: "A new idea." }), madeOf("cosy"), madeOf("work")], { used: 6, limit: 10 }));

      expect(await screen.findByText("A new idea.")).toBeTruthy();
      expect(reported).toEqual([expect.objectContaining({ replaceAll: true })]);
      expect(screen.getByText("AI calls used this session: 6 of 10")).toBeTruthy();
    });
  });

  describe("pieces that the app moved", () => {
    it("says which, in the card of the layout, by name and place in the list, so that the user knows it is not exactly what the AI said", async () => {
      request.mockResolvedValue(success([madeOf("spacious"), madeOf("cosy", { adjusted: [1, 2] }), madeOf("work")]));
      const { user, button } = setup();

      await user.click(button());

      expect(await card("cosy").findByText(/2 pieces were adjusted a little by the app, so that nothing overlaps or goes through a wall: Coffee table \(item 2\), TV stand \(item 3\)\./)).toBeTruthy();
      expect(card("spacious").queryByText(/adjusted a little/)).toBeNull();
      expect(card("work").queryByText(/adjusted a little/)).toBeNull();
    });

    it("says it right for one piece", async () => {
      request.mockResolvedValue(success([madeOf("spacious", { adjusted: [0] }), madeOf("cosy"), madeOf("work")]));
      const { user, button } = setup();

      await user.click(button());

      expect(await card("spacious").findByText(/^1 piece was adjusted a little by the app, so that nothing overlaps or goes through a wall: Sofa \(item 1\)\.$/)).toBeTruthy();
    });

    it("says nothing about it when no piece was moved", async () => {
      request.mockResolvedValue(success());
      const { user, button } = setup();

      await user.click(button());

      await screen.findByRole("list");
      expect(screen.queryByText(/adjusted a little by the app/)).toBeNull();
    });
  });

  describe("choosing which layout the 3D room shows", () => {
    const withThree = (shown: LayoutStyle | null = "spacious") => setup(description, alreadyMade(...three()), shown);
    const showButton = (style: LayoutStyle) => card(style).getByRole("button", { name: "Show in the 3D room" });

    it("has a button on each card, pressed on the card of the layout that is shown and not on the others", () => {
      withThree("cosy");

      expect(showButton("spacious").getAttribute("aria-pressed")).toBe("false");
      expect(showButton("cosy").getAttribute("aria-pressed")).toBe("true");
      expect(showButton("work").getAttribute("aria-pressed")).toBe("false");
    });

    it("tells its parent which layout was chosen, and the pressed button moves to it", async () => {
      const { user } = withThree("spacious");

      await user.click(showButton("work"));

      expect(shownByUser).toEqual(["work"]);
      expect(showButton("work").getAttribute("aria-pressed")).toBe("true");
      expect(showButton("spacious").getAttribute("aria-pressed")).toBe("false");
    });

    it("keeps the same button name on every card, and says whose it is in its description, so that a screen reader can tell them apart", () => {
      withThree();

      for (const style of LAYOUT_STYLES) {
        const button = showButton(style);
        const described = document.getElementById(button.getAttribute("aria-describedby")!);
        expect(described?.textContent, style).toBe(STYLE_NAMES[style]);
      }
    });

    it("marks no card as the shown one when the parent shows none", () => {
      withThree(null);

      for (const style of LAYOUT_STYLES) expect(showButton(style).getAttribute("aria-pressed")).toBe("false");
    });

    it("can be used while a layout is being made", async () => {
      request.mockReturnValue(deferred<LayoutOutcome>().promise);
      const { user, button } = withThree();

      await user.click(button());
      await user.click(showButton("cosy"));

      expect(shownByUser).toEqual(["cosy"]);
    });
  });

  describe("a style that fails while the others work (AC4)", () => {
    const twoAndAFailure = (code: StyleFailureCode = "invalid_answer", message?: string) =>
      success([madeOf("spacious"), failedOf("cosy", code, message), madeOf("work")], { used: 4, limit: 10 });

    it("shows a message for that style, in its own place in the order, and the other two layouts", async () => {
      request.mockResolvedValue(twoAndAFailure());
      const { user, button } = setup();

      await user.click(button());

      await screen.findByRole("list");
      expect(names()).toEqual(["Spacious", "Cosy", "Work-focused"]);
      expect(error()).toEqual(["CosyThe AI could not make a usable Cosy layout this time.Try again"]);
      expect(card("spacious").getByRole("button", { name: "Show in the 3D room" })).toBeTruthy();
      expect(card("work").getByRole("button", { name: "Show in the 3D room" })).toBeTruthy();
      expect(card("cosy").queryByRole("table")).toBeNull();
      expect(card("cosy").queryByRole("button", { name: "Show in the 3D room" })).toBeNull();
    });

    it("has a Try again button that is for that style, and describes it by the name of the style", async () => {
      request.mockResolvedValue(twoAndAFailure());
      const { user, button } = setup();
      await user.click(button());

      const retry = await card("cosy").findByRole("button", { name: "Try again" });

      expect(document.getElementById(retry.getAttribute("aria-describedby")!)?.textContent).toBe("Cosy");
    });

    it("asks for that style alone, and tells the server the layouts that worked, so that the new one differs from them", async () => {
      request.mockResolvedValueOnce(twoAndAFailure()).mockResolvedValueOnce(success([madeOf("cosy")], { used: 5, limit: 10 }));
      const { user, button } = setup();
      await user.click(button());

      await user.click(await card("cosy").findByRole("button", { name: "Try again" }));

      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenLastCalledWith(description, {
        styles: ["cosy"],
        existing: [
          { style: "spacious", poses: POSES.spacious },
          { style: "work", poses: POSES.work },
        ],
      });
    });

    it("puts the new layout in the place of the message, keeps the other two as they were, and tells its parent that it is one style and not a new set", async () => {
      request.mockResolvedValueOnce(twoAndAFailure()).mockResolvedValueOnce(success([madeOf("cosy", { description: "Snug now." })], { used: 5, limit: 10 }));
      const { user, button } = setup();
      await user.click(button());

      await user.click(await card("cosy").findByRole("button", { name: "Try again" }));

      expect(await card("cosy").findByText("Snug now.")).toBeTruthy();
      expect(error()).toEqual([]);
      expect(names()).toEqual(["Spacious", "Cosy", "Work-focused"]);
      expect(reported.at(-1)).toEqual({ made: [madeOf("cosy", { description: "Snug now." })], replaceAll: false });
      expect(screen.getByText("AI calls used this session: 5 of 10")).toBeTruthy();
    });

    it("shows the style as being made again, on its own button, and locks the other buttons that ask the AI, while it is", async () => {
      request.mockResolvedValueOnce(twoAndAFailure()).mockReturnValueOnce(deferred<LayoutOutcome>().promise);
      const { user, button } = setup();
      await user.click(button());

      await user.click(await card("cosy").findByRole("button", { name: "Try again" }));

      const retry = card("cosy").getByRole("button", { name: "Generating…" }) as HTMLButtonElement;
      expect(retry.disabled).toBe(true);
      expect(retry.querySelector('span[aria-hidden="true"]')).not.toBeNull();
      expect(screen.getByRole("status").textContent).toBe("Asking the AI for the Cosy layout again. This can take up to a minute.");
      // The big button does not spin: it is not the one that is working.
      const main = screen.getByRole("button", { name: "Generate layouts" }) as HTMLButtonElement;
      expect(main.disabled).toBe(true);
      expect(main.querySelector("span")).toBeNull();
    });

    it("does not let a style that is not the one being made again ask while another is", async () => {
      request.mockResolvedValueOnce(success([failedOf("spacious"), failedOf("cosy"), madeOf("work")])).mockReturnValueOnce(deferred<LayoutOutcome>().promise);
      const { user, button } = setup();
      await user.click(button());

      await user.click(await card("spacious").findByRole("button", { name: "Try again" }));

      expect((card("cosy").getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
    });

    it("says why a layout was too much like the others, with the message of the server", async () => {
      const message = "The Cosy layout was too much like the others: only 1 of 3 pieces was in a different place, and at least 2 are needed.";
      request.mockResolvedValue(twoAndAFailure("too_similar", message));
      const { user, button } = setup();

      await user.click(button());

      expect(await card("cosy").findByText(message)).toBeTruthy();
      expect(card("cosy").getByRole("button", { name: "Try again" })).toBeTruthy();
    });

    it("says that the AI took too long, for a style that ran out of time, and offers to try again", async () => {
      const message = "The AI took too long to make the Cosy layout. Please try again.";
      request.mockResolvedValue(twoAndAFailure("timed_out", message));
      const { user, button } = setup();

      await user.click(button());

      expect(await card("cosy").findByText(message)).toBeTruthy();
      expect(card("cosy").getByRole("button", { name: "Try again" })).toBeTruthy();
    });

    it("does not offer to try again for a session that is used up, since it would not help", async () => {
      request.mockResolvedValue(twoAndAFailure("limit_reached", "You have used all 10 AI calls for this session."));
      const { user, button } = setup();

      await user.click(button());

      expect(await card("cosy").findByText("You have used all 10 AI calls for this session.")).toBeTruthy();
      expect(card("cosy").queryByRole("button")).toBeNull();
    });

    it("can have more than one style that fails, each with its own message and button", async () => {
      request.mockResolvedValue(success([failedOf("spacious"), failedOf("cosy", "layout_has_overlaps", "The Cosy layout still had furniture overlapping."), madeOf("work")]));
      const { user, button } = setup();

      await user.click(button());

      await screen.findByRole("list");
      expect(error()).toEqual([
        "SpaciousThe AI could not make a usable Spacious layout this time.Try again",
        "CosyThe Cosy layout still had furniture overlapping.Try again",
      ]);
    });

    it("says nothing about positions or the 3D room when no style has a layout to show", () => {
      setup(description, alreadyMade(failedOf("spacious"), failedOf("cosy"), failedOf("work")));

      expect(screen.queryByText(/The 3D room above shows/)).toBeNull();
      expect(screen.queryByText(/A position is the middle/)).toBeNull();
      expect(error()).toHaveLength(3);
    });

    it("tells the user when making the style again fails too, keeps the message of the style, and offers to try that style again", async () => {
      request
        .mockResolvedValueOnce(twoAndAFailure())
        .mockResolvedValueOnce(failure({ message: "We could not reach the server. Check your internet connection and try again.", code: "network" }))
        .mockResolvedValueOnce(success([madeOf("cosy")]));
      const { user, button } = setup();
      await user.click(button());

      await user.click(await card("cosy").findByRole("button", { name: "Try again" }));

      expect(await screen.findByText("We could not reach the server. Check your internet connection and try again.")).toBeTruthy();
      expect(names()).toEqual(["Spacious", "Cosy", "Work-focused"]);
      expect(card("spacious").getByRole("table")).toBeTruthy();
      // The button of the message asks for the same style again, with the layouts that worked.
      const buttons = screen.getAllByRole("button", { name: "Try again" });
      await user.click(buttons[0]);
      expect(request).toHaveBeenLastCalledWith(description, expect.objectContaining({ styles: ["cosy"] }));
      expect(await card("cosy").findByRole("table")).toBeTruthy();
    });
  });

  describe("when no layout can be made", () => {
    it("shows the message in an alert, and offers to try again when that can help", async () => {
      request.mockResolvedValue(failure());
      const { user, button } = setup();

      await user.click(button());

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(error()).toEqual(["The AI service is not available right now. Please try again in a moment.Try again"]);
      expect(screen.queryByRole("list")).toBeNull();
      expect(button().disabled).toBe(false);
      expect(reported).toEqual([]);
    });

    it("asks again for all three when the user chooses to try again, and clears the error when that works", async () => {
      request.mockResolvedValueOnce(failure()).mockResolvedValueOnce(success());
      const { user, button } = setup();
      await user.click(button());

      await user.click(await screen.findByRole("button", { name: "Try again" }));

      expect(await screen.findByRole("list")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenLastCalledWith(description, { styles: undefined, existing: [] });
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

    it("keeps the layouts that were there, and what the 3D room shows, when new ones fail", async () => {
      request.mockResolvedValueOnce(success()).mockResolvedValueOnce(failure({ message: "The AI could not make a usable layout this time. Please try again." }));
      const { user, button } = setup();
      await user.click(button());
      await screen.findByRole("list");

      await user.click(button());

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(names()).toEqual(["Spacious", "Cosy", "Work-focused"]);
      expect(rowsOf("cosy")).toHaveLength(3);
      expect(reported).toHaveLength(1);
      expect(shownByUser).toEqual([]);
    });

    it("replaces the layouts when new ones are made, and shows the count of the new answer", async () => {
      request.mockResolvedValueOnce(success(three(), { used: 3, limit: 10 })).mockResolvedValueOnce(success([madeOf("spacious", { poses: POSES.work }), madeOf("cosy"), madeOf("work")], { used: 6, limit: 10 }));
      const { user, button } = setup();
      await user.click(button());
      await screen.findByRole("list");

      await user.click(button());

      expect(await screen.findByText("AI calls used this session: 6 of 10")).toBeTruthy();
      expect(rowsOf("spacious")[0]).toBe("Sofa (item 1)x 1.50, z 1.00the left wall");
    });

    it("shows the error and not the loading indicator once the call is over", async () => {
      request.mockResolvedValue(failure());
      const { user, button } = setup();

      await user.click(button());

      await screen.findByRole("alert");
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("does not leave the message of an earlier failure on the page when the next try works", async () => {
      request.mockResolvedValueOnce(failure()).mockResolvedValueOnce(success());
      const { user, button } = setup();
      await user.click(button());
      await screen.findByRole("alert");

      await user.click(button());

      await screen.findByRole("list");
      expect(screen.queryByText(/The AI service is not available/)).toBeNull();
    });
  });

  describe("a room that cannot hold its furniture", () => {
    // Six sofas of 1.8 m2 on 12 m2: 90% of the floor.
    const full = { room: { ...room, width_m: 4, length_m: 3 }, furniture: Array.from({ length: 6 }, () => sofa) };

    it("says why, and does not offer layouts, without asking the AI", async () => {
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

    it("warns that layouts may not be possible, and still lets the user ask", async () => {
      request.mockResolvedValue(success(LAYOUT_STYLES.map((style) => madeOf(style, { poses: Array.from({ length: 10 }, () => POSES[style][0]) }))));
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

  describe("the layouts that its parent gives it", () => {
    it("shows them as soon as they are there, and the count of calls only once it has made some itself", () => {
      setup(description, alreadyMade(madeOf("spacious", { adjusted: [2] }), madeOf("cosy"), failedOf("work")), "spacious");

      expect(names()).toEqual(["Spacious", "Cosy", "Work-focused"]);
      expect(card("spacious").getByText(/1 piece was adjusted a little by the app/)).toBeTruthy();
      expect(screen.getByText(/The 3D room above shows the layout that you chose/)).toBeTruthy();
      expect(screen.queryByText(/AI calls used this session/)).toBeNull();
      expect(request).not.toHaveBeenCalled();
    });

    it("shows only the styles that have a result, in the order of the styles", () => {
      setup(description, alreadyMade(madeOf("work"), madeOf("spacious")));

      expect(names()).toEqual(["Spacious", "Work-focused"]);
    });

    it("shows nothing about layouts when its parent has none", () => {
      setup();

      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByRole("list")).toBeNull();
    });
  });
});
