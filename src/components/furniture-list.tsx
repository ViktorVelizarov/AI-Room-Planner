import { FURNITURE_NAMES, type FurnitureItem } from "../shared/furniture";

const cm = (n: number) => Math.round(n);

/** The furniture the AI found: what each piece is, its estimated size, and its colour and material. */
export function FurnitureList({
  items,
  unsupported,
}: {
  items: FurnitureItem[];
  /** How many things were found that are not a supported type and so are not in `items`. */
  unsupported: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">Detected furniture ({items.length})</h3>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No supported furniture was found in these photos. Try again with other photos.
        </p>
      ) : (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Sizes are estimates: width × depth × height.
          </p>
          <ul className="divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/15 dark:border-white/15">
            {items.map((item, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{FURNITURE_NAMES[item.label]}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {item.color} · {item.material}
                  </p>
                </div>
                <p className="shrink-0 text-sm tabular-nums">
                  {cm(item.width_cm)} × {cm(item.depth_cm)} × {cm(item.height_cm)} cm
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {unsupported > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {unsupported === 1
            ? "1 other item is not a supported furniture type and was left out."
            : `${unsupported} other items are not supported furniture types and were left out.`}
        </p>
      )}
    </div>
  );
}
