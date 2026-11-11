// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StyledLayout } from "../shared/api";
import { LAYOUT_STYLES, STYLE_NAMES, type LayoutStyle } from "../shared/layout-styles";
import { LayoutSwitcher } from "./layout-switcher";

afterEach(cleanup);

const madeOf = (style: LayoutStyle, overrides: Partial<StyledLayout> = {}): StyledLayout => ({
  style,
  ok: true,
  name: STYLE_NAMES[style],
  description: `The idea of the ${STYLE_NAMES[style]} layout.`,
  poses: [{ x_m: 0, z_m: 0, rotation_deg: 0 }],
  adjusted: [],
  ...overrides,
});
const three = () => LAYOUT_STYLES.map((style) => madeOf(style));

const group = () => screen.getByRole("group", { name: "Layout" });
const buttons = () => within(group()).getAllByRole("button");
const names = () => buttons().map((button) => button.textContent);
const pressedStates = () => buttons().map((button) => button.getAttribute("aria-pressed"));
/** The line under the buttons that says what the layout that is shown is about. */
const idea = () => group().nextElementSibling as HTMLElement;

describe("LayoutSwitcher: a button for each layout (AC1)", () => {
  it("has a button for each layout that was made, in the order that they are given, named by the name of the layout", () => {
    render(<LayoutSwitcher layouts={three()} shown="spacious" onShow={() => {}} />);

    expect(names()).toEqual(["Spacious", "Cosy", "Work-focused"]);
  });

  it("has a button only for the layouts that there are: a style that failed has none", () => {
    render(<LayoutSwitcher layouts={[madeOf("spacious"), madeOf("work")]} shown="spacious" onShow={() => {}} />);

    expect(names()).toEqual(["Spacious", "Work-focused"]);
  });

  it("has one button for one layout, which is shown, and says what it is about", () => {
    render(<LayoutSwitcher layouts={[madeOf("cosy")]} shown="cosy" onShow={() => {}} />);

    expect(names()).toEqual(["Cosy"]);
    expect(pressedStates()).toEqual(["true"]);
    expect(idea().textContent).toBe("Cosy: The idea of the Cosy layout.");
  });

  it("says nothing, and has no buttons, when there are no layouts", () => {
    const { container } = render(<LayoutSwitcher layouts={[]} shown={null} onShow={() => {}} />);

    expect(container.childElementCount).toBe(0);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("calls the buttons by the name of the layout and nothing else, so that they can be found by it", () => {
    render(<LayoutSwitcher layouts={three()} shown="cosy" onShow={() => {}} />);

    for (const style of LAYOUT_STYLES) expect(screen.getByRole("button", { name: STYLE_NAMES[style] })).toBeTruthy();
  });
});

describe("LayoutSwitcher: the layout that is shown (AC3)", () => {
  it.each([
    ["spacious", ["true", "false", "false"]],
    ["cosy", ["false", "true", "false"]],
    ["work", ["false", "false", "true"]],
  ] as const)("presses the button of the layout that is shown, and only that one: %s", (shown, expected) => {
    render(<LayoutSwitcher layouts={three()} shown={shown} onShow={() => {}} />);

    expect(pressedStates()).toEqual(expected);
  });

  it("fills the button of the layout that is shown and outlines the others, so that it can be told without the colours", () => {
    render(<LayoutSwitcher layouts={three()} shown="cosy" onShow={() => {}} />);

    const [spacious, cosy, work] = buttons();
    expect(cosy.className).toContain("bg-foreground");
    expect(spacious.className).not.toContain("bg-foreground");
    expect(work.className).not.toContain("bg-foreground");
    expect(spacious.className).toContain("border-black/15");
  });

  it("writes the name and the idea of the layout that is shown, under the buttons, where the user is looking", () => {
    render(<LayoutSwitcher layouts={three()} shown="work" onShow={() => {}} />);

    expect(idea().textContent).toBe("Work-focused: The idea of the Work-focused layout.");
    expect(within(idea()).getByText("Work-focused:").className).toContain("font-semibold");
  });

  it("writes the idea of the layout as it is, however long, and not of the other layouts", () => {
    const long = "A work area with the desk at its heart, kept apart from the rest of the furniture, which stays within reach. ".repeat(2).trim();
    render(<LayoutSwitcher layouts={[madeOf("spacious"), madeOf("work", { description: long })]} shown="work" onShow={() => {}} />);

    expect(idea().textContent).toBe(`Work-focused: ${long}`);
    expect(screen.queryByText(/The idea of the Spacious layout/)).toBeNull();
  });

  it("follows the layout that is shown when it changes: the pressed button and the idea move to it", () => {
    const { rerender } = render(<LayoutSwitcher layouts={three()} shown="spacious" onShow={() => {}} />);
    expect(idea().textContent).toBe("Spacious: The idea of the Spacious layout.");

    rerender(<LayoutSwitcher layouts={three()} shown="cosy" onShow={() => {}} />);

    expect(pressedStates()).toEqual(["false", "true", "false"]);
    expect(idea().textContent).toBe("Cosy: The idea of the Cosy layout.");
  });

  it("has no button pressed and writes nothing when no layout is shown", () => {
    render(<LayoutSwitcher layouts={three()} shown={null} onShow={() => {}} />);

    expect(pressedStates()).toEqual(["false", "false", "false"]);
    expect(idea().textContent).toBe("");
  });

  it("writes nothing for a layout that is shown but is not among the layouts it is given", () => {
    render(<LayoutSwitcher layouts={[madeOf("spacious"), madeOf("work")]} shown="cosy" onShow={() => {}} />);

    expect(pressedStates()).toEqual(["false", "false"]);
    expect(idea().textContent).toBe("");
  });

  it("says the idea in a live region that is on the page all the time, so that a screen reader says the idea of the layout that was chosen", () => {
    const { rerender } = render(<LayoutSwitcher layouts={three()} shown={null} onShow={() => {}} />);
    expect(idea().getAttribute("aria-live")).toBe("polite");
    const region = idea();

    rerender(<LayoutSwitcher layouts={three()} shown="cosy" onShow={() => {}} />);

    // The same element, which had been empty: what comes into a live region is what is read out.
    expect(idea()).toBe(region);
    expect(idea().getAttribute("aria-live")).toBe("polite");
  });

  it("names the group of buttons Layout, in words that are on the page, so that a screen reader says what the buttons are for", () => {
    render(<LayoutSwitcher layouts={three()} shown="spacious" onShow={() => {}} />);

    expect(within(group()).getByText("Layout")).toBeTruthy();
    expect(group().getAttribute("aria-labelledby")).toBe(within(group()).getByText("Layout").id);
  });

  it("has the word Layout on a line of its own on a narrow screen, so that the three buttons are together on the next, and beside them on a wide one", () => {
    render(<LayoutSwitcher layouts={three()} shown="spacious" onShow={() => {}} />);

    const label = within(group()).getByText("Layout");
    expect(label.className).toContain("w-full");
    expect(label.className).toContain("sm:w-auto");
  });

  it("has buttons that are a little narrower on a phone, so that the three fit in one line there", () => {
    render(<LayoutSwitcher layouts={three()} shown="spacious" onShow={() => {}} />);

    for (const button of buttons()) {
      expect(button.className).toContain("px-3");
      expect(button.className).toContain("sm:px-4");
    }
  });

  it("gives two switchers on a page each its own label, so that one is not named by the other", () => {
    render(
      <>
        <LayoutSwitcher layouts={three()} shown="spacious" onShow={() => {}} />
        <LayoutSwitcher layouts={three()} shown="cosy" onShow={() => {}} />
      </>,
    );

    const groups = screen.getAllByRole("group", { name: "Layout" });
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((each) => each.getAttribute("aria-labelledby"))).size).toBe(2);
  });
});

describe("LayoutSwitcher: choosing a layout (AC2)", () => {
  it("chooses the layout of the button that is pressed, once, and nothing else", async () => {
    const user = userEvent.setup();
    const onShow = vi.fn();
    render(<LayoutSwitcher layouts={three()} shown="spacious" onShow={onShow} />);

    await user.click(screen.getByRole("button", { name: "Cosy" }));

    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith("cosy");
  });

  it.each(LAYOUT_STYLES)("chooses %s when its button is pressed, whichever is shown", async (style) => {
    const user = userEvent.setup();
    const onShow = vi.fn();
    render(<LayoutSwitcher layouts={three()} shown="cosy" onShow={onShow} />);

    await user.click(screen.getByRole("button", { name: STYLE_NAMES[style] }));

    expect(onShow).toHaveBeenCalledWith(style);
  });

  it("does not choose anything by itself: not when it is put on the page, and not when what it shows changes", () => {
    const onShow = vi.fn();
    const { rerender } = render(<LayoutSwitcher layouts={three()} shown="spacious" onShow={onShow} />);

    rerender(<LayoutSwitcher layouts={three()} shown="work" onShow={onShow} />);

    expect(onShow).not.toHaveBeenCalled();
  });

  it("can be used with the keyboard: Tab goes from button to button, and Enter and Space choose", async () => {
    const user = userEvent.setup();
    const onShow = vi.fn();
    render(<LayoutSwitcher layouts={three()} shown="spacious" onShow={onShow} />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Spacious" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cosy" }));
    await user.keyboard("{Enter}");
    await user.tab();
    await user.keyboard(" ");

    expect(onShow.mock.calls).toEqual([["cosy"], ["work"]]);
  });

  it("keeps the focus on the button that was pressed when the layout that is shown changes, so that a keyboard user does not lose their place", async () => {
    const user = userEvent.setup();
    function Holder() {
      const [shown, setShown] = useState<LayoutStyle>("spacious");
      return <LayoutSwitcher layouts={three()} shown={shown} onShow={setShown} />;
    }
    render(<Holder />);

    await user.click(screen.getByRole("button", { name: "Cosy" }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cosy" }));
    expect(pressedStates()).toEqual(["false", "true", "false"]);
    expect(idea().textContent).toBe("Cosy: The idea of the Cosy layout.");
  });

  it("lets the user press the button of the layout that is shown, which chooses it again and does no harm", async () => {
    const user = userEvent.setup();
    const onShow = vi.fn();
    render(<LayoutSwitcher layouts={three()} shown="cosy" onShow={onShow} />);

    await user.click(screen.getByRole("button", { name: "Cosy" }));

    expect(onShow).toHaveBeenCalledWith("cosy");
    expect(pressedStates()).toEqual(["false", "true", "false"]);
  });
});

describe("LayoutSwitcher: what it is given", () => {
  it("does not change the layouts that it is given", () => {
    const given = Object.freeze(three().map((layout) => Object.freeze({ ...layout })));

    render(<LayoutSwitcher layouts={given} shown="work" onShow={() => {}} />);

    expect(given).toEqual(three());
  });

  it("is one box with the buttons over the idea, that can wrap on a narrow screen, with no width of its own", () => {
    const { container } = render(<LayoutSwitcher layouts={three()} shown="cosy" onShow={() => {}} />);

    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toContain("flex-col");
    expect(group().className).toContain("flex-wrap");
    expect(box.className).not.toMatch(/\bw-\d|\bw-\[|min-w/);
  });
});
