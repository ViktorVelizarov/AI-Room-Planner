import { formatMetres } from "../shared/room";
import type { RoomDescription } from "../shared/room-description";

/**
 * A plain look at the room description, as the 3D room and the layouts will receive it. It is
 * for checking the data, so it shows the JSON itself rather than a nicer version of it. It is
 * folded away until it is opened, so that it does not take the place of what the user came to see.
 */
export function RoomDescriptionView({ description }: { description: RoomDescription }) {
  const { room, furniture } = description;
  const pieces = furniture.length === 1 ? "1 piece" : `${furniture.length} pieces`;

  return (
    <details className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <summary className="cursor-pointer text-base font-semibold">Room description (JSON)</summary>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {formatMetres(room.width_m)} × {formatMetres(room.length_m)} m, {formatMetres(room.height_m)} m
        high, with {pieces} of furniture. Each piece is identified by its place in the list.
      </p>
      <div
        role="region"
        aria-label="Room description JSON"
        tabIndex={0}
        className="mt-3 max-h-96 overflow-auto rounded-lg bg-black/4 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-white/6"
      >
        <pre className="text-xs leading-5">{JSON.stringify(description, null, 2)}</pre>
      </div>
    </details>
  );
}
