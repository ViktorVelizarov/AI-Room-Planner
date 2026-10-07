import type { FurnitureEntry } from "../shared/furniture-list";
import { formatMetres, type RoomSize } from "../shared/room";
import { FurnitureEditor } from "./furniture-editor";

/** The room as it stands: its size, and its furniture, which the user can correct. */
export function RoomSummary({
  size,
  entries,
  unsupported,
  onEntriesChange,
  onBack,
}: {
  size: RoomSize;
  entries: FurnitureEntry[];
  unsupported: number;
  onEntriesChange: (entries: FurnitureEntry[]) => void;
  onBack: () => void;
}) {
  return (
    <section
      aria-labelledby="summary-heading"
      className="flex flex-col gap-5 rounded-2xl border border-black/10 p-6 dark:border-white/15"
    >
      <h2 id="summary-heading" className="text-lg font-semibold">
        Your room
      </h2>

      <dl>
        <dt className="text-sm text-zinc-600 dark:text-zinc-400">Room size</dt>
        <dd className="text-base font-medium">
          {formatMetres(size.width_m)} × {formatMetres(size.length_m)} m,{" "}
          {formatMetres(size.height_m)} m high
        </dd>
      </dl>

      <FurnitureEditor entries={entries} unsupported={unsupported} onChange={onEntriesChange} />

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Next: see your room in 3D. Not built yet.
      </p>

      <div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/20 dark:hover:bg-white/10"
        >
          Back to room size
        </button>
      </div>
    </section>
  );
}
