"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { StyleResult } from "../shared/api";
import { LAYOUT_STYLES, type LayoutStyle } from "../shared/layout-styles";
import type { RoomDescription } from "../shared/room-description";
import { LayoutGenerator, type LayoutResults } from "./layout-generator";
import { LayoutSwitcher } from "./layout-switcher";
import { RoomDescriptionView } from "./room-description-view";

// The 3D code is large, so it is loaded when the user first reaches the 3D room, not with the page.
const Room3DView = dynamic(() => import("./room-3d-view").then((module) => module.Room3DView), {
  ssr: false,
  loading: () => (
    <p
      role="status"
      className="flex h-80 items-center justify-center rounded-lg bg-black/4 text-sm text-zinc-600 sm:h-112 dark:bg-white/6 dark:text-zinc-400"
    >
      Loading the 3D view…
    </p>
  ),
});

/**
 * What the 3D room step holds: the room in 3D, the box that asks the AI for layouts, and the room
 * description. It owns the layouts, three in different styles (US-21), because the box makes them and
 * the 3D view shows one of them: until there are any, the furniture is lined up along the back wall,
 * and from then on it stands as the chosen layout says. A new set shows its first layout, and the
 * user chooses another with the buttons right under the 3D view (`LayoutSwitcher`, US-23, which
 * also say what the shown layout is about) or with the button of its card, both of which choose the
 * same one; one style made again does not change what is shown.
 *
 * The page gives it a `key` made from `layoutKey(description)`, so it starts over, with no layouts, when
 * the types or sizes of the furniture or the floor of the room change. A layout is therefore never
 * shown for furniture that it was not made for, and one that is still on its way when that happens is
 * lost with the old step. It stays while the step is hidden, so that layouts that were paid for, or
 * ones that are being made, are not lost when the user goes back. The 3D view and the description are
 * only made while the step is `active`, so the 3D view is made when it is needed and freed when the
 * user leaves.
 */
export function Room3DStep({
  description,
  active,
  onBack,
}: {
  description: RoomDescription;
  active: boolean;
  onBack: () => void;
}) {
  const [results, setResults] = useState<LayoutResults>({});
  const [shownStyle, setShownStyle] = useState<LayoutStyle | null>(null);
  // The layout that the 3D room shows: the chosen style, if it has one.
  const chosen = shownStyle ? results[shownStyle] : undefined;
  const layout = chosen?.ok ? chosen : null;
  // The layouts that were made, in the order of the styles: a style that failed has none, so it has no button.
  const madeLayouts = LAYOUT_STYLES.flatMap((style) => {
    const result = results[style];
    return result?.ok ? [result] : [];
  });

  function handleResults(made: StyleResult[], replaceAll: boolean) {
    setResults((previous) => ({ ...(replaceAll ? {} : previous), ...Object.fromEntries(made.map((result) => [result.style, result])) }));
    const first = LAYOUT_STYLES.find((style) => made.some((result) => result.style === style && result.ok)) ?? null;
    setShownStyle((previous) => (replaceAll ? first : (previous ?? first)));
  }

  return (
    <section
      aria-labelledby="room-3d-heading"
      className="flex flex-col gap-5 rounded-2xl border border-black/10 p-6 dark:border-white/15"
    >
      <div>
        <h2 id="room-3d-heading" className="text-lg font-semibold">
          3D room
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Your room at the size you entered, with your furniture{" "}
          {layout ? `arranged as in the ${layout.name} layout below` : "lined up along the back wall in the order of your list"}. Each piece takes
          the colour and material found for it; where there is none, the model keeps its own look. Look around it to check that the room and
          the furniture match the real ones.
        </p>
      </div>

      {active && (
        <Room3DView description={description} layout={layout?.poses} layoutName={layout?.name}>
          <LayoutSwitcher layouts={madeLayouts} shown={layout ? layout.style : null} onShow={setShownStyle} />
        </Room3DView>
      )}

      <LayoutGenerator description={description} results={results} shown={layout ? layout.style : null} onResults={handleResults} onShow={setShownStyle} />

      <div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/20 dark:hover:bg-white/10"
        >
          Back to your room
        </button>
      </div>

      {active && <RoomDescriptionView description={description} />}
    </section>
  );
}
