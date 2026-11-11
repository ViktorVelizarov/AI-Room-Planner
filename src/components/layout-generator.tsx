"use client";

import { useId, useState } from "react";
import { requestLayout, type LayoutFailure } from "../client/layout-client";
import type { Calls, StyledLayout, StyleFailure, StyleResult } from "../shared/api";
import { crowdedWarning, describeFacing, describePiece, whyNoLayoutIsPossible } from "../shared/layout";
import { LAYOUT_STYLES, STYLE_NAMES, type LayoutStyle } from "../shared/layout-styles";
import type { RoomDescription } from "../shared/room-description";

/** The layouts that are made, by style. A style that has not been asked for yet has none. */
export type LayoutResults = Partial<Record<LayoutStyle, StyleResult>>;

/** `styles` are the ones being made: all of them, or the one that is made again. */
type State =
  | { status: "idle" }
  | { status: "loading"; styles: readonly LayoutStyle[] }
  | { status: "failed"; failure: LayoutFailure; styles: readonly LayoutStyle[] };

/** A place in metres with two decimals and never "-0.00". */
const metres = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

const NOTE = "rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100";
const SMALL_BUTTON =
  "shrink-0 rounded-full border border-black/15 px-4 py-1.5 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

/**
 * Asks the AI for three arrangements of the furniture in the room, in the styles Spacious, Cosy and
 * Work-focused (US-21), and shows each as a card: its name, the idea of the layout, and where each
 * piece goes. A style that failed says why and can be made again on its own, told where the other
 * layouts put the pieces so that it differs from them; the others stay.
 *
 * The layouts belong to the parent, which also shows the chosen one in the 3D room: `onResults` is
 * called with each answer (`replaceAll` for a new set of three, and not for one style made again),
 * `results` is what was made, which stays on the page while new ones are asked for, or when that fails,
 * and `shown` is the style that the 3D room shows. A request that fails, or has not been made yet,
 * changes nothing. The parent starts over, with no layouts and a new copy of this, when the room or the
 * furniture changes in a way that a layout depends on (`layoutKey`), so a layout is never shown for
 * furniture that is not the furniture it was made for, and an answer still on its way is lost with the
 * old copy.
 */
export function LayoutGenerator({
  description,
  results,
  shown,
  onResults,
  onShow,
}: {
  description: RoomDescription;
  results: LayoutResults;
  shown: LayoutStyle | null;
  onResults: (made: StyleResult[], replaceAll: boolean) => void;
  onShow: (style: LayoutStyle) => void;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [calls, setCalls] = useState<Calls | null>(null);

  const loading = state.status === "loading";
  // Why layouts cannot be made, which is known without asking the AI, and a warning that it may not work.
  const cannot = whyNoLayoutIsPossible(description);
  const warning = cannot ? null : crowdedWarning(description);

  /** Makes the layouts of the given styles, or of all three. One style is made again with the others that are made to differ from. */
  async function generate(styles?: readonly LayoutStyle[]) {
    const wanted = styles ?? LAYOUT_STYLES;
    setState({ status: "loading", styles: wanted });
    const existing = styles
      ? LAYOUT_STYLES.flatMap((style) => {
          const result = results[style];
          return !styles.includes(style) && result?.ok ? [{ style, poses: result.poses }] : [];
        })
      : [];
    const outcome = await requestLayout(description, { styles, existing });
    if (outcome.ok) {
      setCalls(outcome.data.calls);
      onResults(outcome.data.results, !styles);
      setState({ status: "idle" });
    } else {
      if (outcome.failure.calls) setCalls(outcome.failure.calls);
      setState({ status: "failed", failure: outcome.failure, styles: wanted });
    }
  }

  const made = LAYOUT_STYLES.flatMap((style) => (results[style] ? [results[style]] : []));
  const loadingText =
    state.status === "loading" && state.styles.length === 1
      ? `Asking the AI for the ${STYLE_NAMES[state.styles[0]]} layout again. This can take up to a minute.`
      : "Asking the AI for three layouts. This can take a minute or two.";

  return (
    <section aria-labelledby="layout-heading" className="flex flex-col gap-4 rounded-xl border border-black/10 p-5 dark:border-white/15">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-60 flex-1">
          <h3 id="layout-heading" className="font-semibold">
            Suggest layouts
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            The AI arranges your furniture in this room in three styles: Spacious, Cosy and Work-focused. It uses three AI calls, or
            more if an answer cannot be used.
          </p>
        </div>
        <button
          type="button"
          onClick={() => generate()}
          disabled={loading || cannot !== null}
          className="flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && state.styles.length > 1 && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-background/30 border-t-background motion-reduce:animate-none"
            />
          )}
          {loading && state.styles.length > 1 ? "Generating…" : "Generate layouts"}
        </button>
      </div>

      {cannot && <p className={NOTE}>{cannot}</p>}
      {warning && <p className={NOTE}>{warning}</p>}

      {loading && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          {loadingText}
        </p>
      )}

      {state.status === "failed" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          <p>{state.failure.message}</p>
          {state.failure.retryable && (
            <button
              type="button"
              onClick={() => generate(state.styles.length === LAYOUT_STYLES.length ? undefined : state.styles)}
              className="shrink-0 rounded-full border border-red-900/30 px-4 py-1.5 font-medium hover:bg-red-900/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-red-100/30 dark:hover:bg-red-100/10"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {made.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="text-sm font-semibold">Suggested layouts</h4>
          <ul className="flex flex-col gap-3">
            {made.map((result) => (
              <li key={result.style}>
                {result.ok ? (
                  <LayoutCard description={description} layout={result} isShown={shown === result.style} onShow={() => onShow(result.style)} />
                ) : (
                  <FailedCard
                    failure={result}
                    busy={loading}
                    making={loading && state.styles.includes(result.style)}
                    onTryAgain={() => generate([result.style])}
                  />
                )}
              </li>
            ))}
          </ul>
          {made.some((result) => result.ok) && (
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                A position is the middle of the piece, in metres from the middle of the room: x towards the right wall and z
                towards the front wall, which is the side you look at the room from.
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                The 3D room above shows the layout that you chose, with the buttons under it or with Show in the 3D room on a card: look around it to judge how the furniture stands.
              </p>
            </>
          )}
        </div>
      )}

      {calls && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          AI calls used this session: {calls.used} of {calls.limit}
        </p>
      )}
    </section>
  );
}

/** One layout: its name and idea, the button that shows it in the 3D room, which pieces the app moved, and where each piece goes. */
function LayoutCard({
  description,
  layout,
  isShown,
  onShow,
}: {
  description: RoomDescription;
  layout: StyledLayout;
  isShown: boolean;
  onShow: () => void;
}) {
  const nameId = useId();
  const name = (index: number) => describePiece(description.furniture[index].label, index);
  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border p-4 ${isShown ? "border-blue-600 dark:border-blue-400" : "border-black/10 dark:border-white/15"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-48 flex-1">
          <h5 id={nameId} className="font-semibold">
            {layout.name}
          </h5>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{layout.description}</p>
        </div>
        <button
          type="button"
          aria-pressed={isShown}
          aria-describedby={nameId}
          onClick={onShow}
          className={`${SMALL_BUTTON} ${isShown ? "border-transparent bg-foreground text-background hover:bg-foreground hover:opacity-85 dark:hover:bg-foreground" : ""}`}
        >
          Show in the 3D room
        </button>
      </div>

      {layout.adjusted.length > 0 && (
        <p className={NOTE}>
          {layout.adjusted.length === 1 ? "1 piece was" : `${layout.adjusted.length} pieces were`} adjusted a little by the app, so
          that nothing overlaps or goes through a wall: {layout.adjusted.map(name).join(", ")}.
        </p>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium">Where each piece goes</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Where each piece goes in the {layout.name} layout</caption>
            <thead>
              <tr className="border-b border-black/10 text-xs text-zinc-500 dark:border-white/15 dark:text-zinc-400">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Piece
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Position (m)
                </th>
                <th scope="col" className="py-2 font-medium">
                  Faces
                </th>
              </tr>
            </thead>
            <tbody>
              {layout.poses.map((pose, index) => (
                <tr key={index} className="border-b border-black/5 last:border-0 dark:border-white/10">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {name(index)}
                  </th>
                  <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                    x {metres(pose.x_m)}, z {metres(pose.z_m)}
                  </td>
                  <td className="py-2">{describeFacing(pose.rotation_deg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** A style that has no layout: why, and a button to make it again, unless asking again cannot help. */
function FailedCard({
  failure,
  busy,
  making,
  onTryAgain,
}: {
  failure: StyleFailure;
  /** Some request is on its way, so nothing new is asked for. */
  busy: boolean;
  /** This style is the one being made again. */
  making: boolean;
  onTryAgain: () => void;
}) {
  const nameId = useId();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <div className="min-w-48 flex-1">
        <h5 id={nameId} className="font-semibold">
          {failure.name}
        </h5>
        <p className="mt-1">{failure.message}</p>
      </div>
      {failure.code !== "limit_reached" && (
        <button
          type="button"
          aria-describedby={nameId}
          onClick={onTryAgain}
          disabled={busy}
          className="flex shrink-0 items-center gap-2 rounded-full border border-red-900/30 px-4 py-1.5 font-medium hover:bg-red-900/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-100/30 dark:hover:bg-red-100/10"
        >
          {making && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-red-900/30 border-t-red-900 motion-reduce:animate-none dark:border-red-100/30 dark:border-t-red-100"
            />
          )}
          {making ? "Generating…" : "Try again"}
        </button>
      )}
    </div>
  );
}
