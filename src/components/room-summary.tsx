import type { FurnitureItem } from "../shared/furniture";
import { formatMetres, type RoomSize } from "../shared/room";
import { FurnitureList } from "./furniture-list";

/** The room as it stands: its size and the furniture found in the photos. */
export function RoomSummary({
  size,
  items,
  unsupported,
  onBack,
}: {
  size: RoomSize;
  items: FurnitureItem[];
  unsupported: number;
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

      <FurnitureList items={items} unsupported={unsupported} />

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Next: correct the furniture list and see your room in 3D. Not built yet.
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
