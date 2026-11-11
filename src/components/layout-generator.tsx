"use client";

import { useState } from "react";
import { requestLayout, type LayoutFailure } from "../client/layout-client";
import type { Calls, LayoutResponse } from "../shared/api";
import { crowdedWarning, describeFacing, describePiece, whyNoLayoutIsPossible } from "../shared/layout";
import type { RoomDescription } from "../shared/room-description";

type State = { status: "idle" } | { status: "loading" } | { status: "failed"; failure: LayoutFailure };

/** A place in metres, with two decimals and never "-0.00". */
const metres = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

const NOTE = "rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100";

/**
 * Asks the AI for a new arrangement of the furniture in the room, and lists where each piece goes.
 * The layout belongs to the parent, which also shows it in the 3D room: `onLayout` is called with
 * each one that is made, and `layout` is the last one made, which stays on the page while a new one
 * is asked for, or when that fails. A layout that fails, or has not been asked for yet, changes
 * nothing. The parent starts over, with no layout and a new copy of this, when the room or the
 * furniture changes in a way that a layout depends on (`layoutKey`), so a layout is never shown for
 * furniture that is not the furniture it was made for, and an answer still on its way is lost with
 * the old copy.
 */
export function LayoutGenerator({
  description,
  layout,
  onLayout,
}: {
  description: RoomDescription;
  layout: LayoutResponse | null;
  onLayout: (layout: LayoutResponse) => void;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [calls, setCalls] = useState<Calls | null>(null);

  const loading = state.status === "loading";
  // Why a layout cannot be made, which is known without asking the AI, and a warning that it may not work.
  const cannot = whyNoLayoutIsPossible(description);
  const warning = cannot ? null : crowdedWarning(description);

  async function generate() {
    setState({ status: "loading" });
    const outcome = await requestLayout(description);
    if (outcome.ok) {
      setCalls(outcome.data.calls);
      onLayout(outcome.data);
      setState({ status: "idle" });
    } else {
      if (outcome.failure.calls) setCalls(outcome.failure.calls);
      setState({ status: "failed", failure: outcome.failure });
    }
  }

  return (
    <section aria-labelledby="layout-heading" className="flex flex-col gap-4 rounded-xl border border-black/10 p-5 dark:border-white/15">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-60 flex-1">
          <h3 id="layout-heading" className="font-semibold">
            Suggest a layout
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            The AI arranges your furniture in this room. It uses one AI call, or two if the first answer cannot be used.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading || cannot !== null}
          className="flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-background/30 border-t-background motion-reduce:animate-none"
            />
          )}
          {loading ? "Generating…" : "Generate layout"}
        </button>
      </div>

      {cannot && <p className={NOTE}>{cannot}</p>}
      {warning && <p className={NOTE}>{warning}</p>}

      {loading && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          Asking the AI for a layout. This can take up to a minute.
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
              onClick={generate}
              className="shrink-0 rounded-full border border-red-900/30 px-4 py-1.5 font-medium hover:bg-red-900/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-red-100/30 dark:hover:bg-red-100/10"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {layout && <SuggestedLayout description={description} layout={layout} />}

      {calls && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          AI calls used this session: {calls.used} of {calls.limit}
        </p>
      )}
    </section>
  );
}

/** Where each piece goes, as a table, and which pieces the app had to move. */
function SuggestedLayout({ description, layout }: { description: RoomDescription; layout: LayoutResponse }) {
  const name = (index: number) => describePiece(description.furniture[index].label, index);
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">Suggested layout</h4>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
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
            {layout.layout.map((pose, index) => (
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
      {layout.adjusted.length > 0 && (
        <p className={NOTE}>
          {layout.adjusted.length === 1 ? "1 piece was" : `${layout.adjusted.length} pieces were`} adjusted a little by the app, so
          that nothing overlaps or goes through a wall: {layout.adjusted.map(name).join(", ")}.
        </p>
      )}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        A position is the middle of the piece, in metres from the middle of the room: x towards the right wall and z
        towards the front wall, which is the side you look at the room from.
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">The 3D room above shows this layout: look around it to judge how the furniture stands.</p>
    </div>
  );
}
