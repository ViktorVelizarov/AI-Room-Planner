"use client";

import { useId } from "react";
import type { StyledLayout } from "../shared/api";
import type { LayoutStyle } from "../shared/layout-styles";

// A little narrower on a phone (px-3), so that the three buttons fit in one line of 390 px.
const BUTTON =
  "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:px-4";
// The layout that is shown is filled, and the others are outlined, so that it can be told without the colours.
const CHOSEN = "border-transparent bg-foreground text-background hover:opacity-85";
const OTHER = "border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";

/**
 * The buttons under the 3D view that choose which layout the 3D room shows (US-23), one for each
 * layout that was made, in the order of the styles, with the name and the idea of the layout that is
 * shown written next to them. The one that is shown is pressed (`aria-pressed`) and filled. A style that
 * failed has no layout and so no button: its card says why. It says nothing when there are no layouts.
 *
 * It only chooses. The 3D room, the cards and this keep to one choice because the step that holds the
 * layouts gives all of them the same `shown` and takes the same `onShow`. Choosing a layout asks the AI
 * for nothing and does not move the camera.
 */
export function LayoutSwitcher({
  layouts,
  shown,
  onShow,
}: {
  /** The layouts that were made, in the order of the styles. */
  layouts: readonly StyledLayout[];
  /** The style of the layout that the 3D room shows, if it shows one. */
  shown: LayoutStyle | null;
  onShow: (style: LayoutStyle) => void;
}) {
  const labelId = useId();
  if (layouts.length === 0) return null;
  const current = layouts.find((layout) => layout.style === shown);

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-2">
        {/* On a narrow screen the word has a line to itself, so that the three buttons are together on the next. */}
        <span id={labelId} className="w-full text-sm font-medium sm:w-auto">
          Layout
        </span>
        {layouts.map((layout) => {
          const isShown = layout.style === shown;
          return (
            <button
              key={layout.style}
              type="button"
              aria-pressed={isShown}
              onClick={() => onShow(layout.style)}
              className={`${BUTTON} ${isShown ? CHOSEN : OTHER}`}
            >
              {layout.name}
            </button>
          );
        })}
      </div>
      {/* A live region, so that a screen reader says the idea of the layout that was chosen. It stays on the page. */}
      <p aria-live="polite" className="text-sm text-zinc-700 dark:text-zinc-300">
        {current && (
          <>
            <span className="font-semibold">{current.name}:</span> {current.description}
          </>
        )}
      </p>
    </div>
  );
}
