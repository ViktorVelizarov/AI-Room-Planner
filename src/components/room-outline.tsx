import { formatMetres } from "../shared/room";

const VIEW = { width: 320, height: 240 };
// Room for the labels along the top and left edges.
const PADDING = { x: 44, y: 40 };

/** The rectangle that draws a room: as large as fits the drawing, centred, with the room's proportions. */
export function fitRoom(width_m: number, length_m: number) {
  const scale = Math.min(
    (VIEW.width - 2 * PADDING.x) / width_m,
    (VIEW.height - 2 * PADDING.y) / length_m,
  );
  const width = width_m * scale;
  const height = length_m * scale;
  return { x: (VIEW.width - width) / 2, y: (VIEW.height - height) / 2, width, height };
}

/** A simple view of the room from above, to check that its size looks right. */
export function RoomOutline({
  width_m,
  length_m,
  height_m,
}: {
  width_m: number;
  length_m: number;
  height_m: number;
}) {
  const room = fitRoom(width_m, length_m);
  const width = formatMetres(width_m);
  const length = formatMetres(length_m);

  return (
    <figure className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label={`Top-down outline of the room, ${width} metres wide and ${length} metres long`}
        className="w-full max-w-sm"
      >
        <rect
          x={room.x}
          y={room.y}
          width={room.width}
          height={room.height}
          rx={2}
          strokeWidth={2}
          className="fill-black/5 stroke-current dark:fill-white/10"
        />
        <text
          x={VIEW.width / 2}
          y={room.y - 10}
          textAnchor="middle"
          className="fill-current text-xs"
        >
          {width} m
        </text>
        <text
          transform={`translate(${room.x - 12} ${VIEW.height / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-current text-xs"
        >
          {length} m
        </text>
      </svg>
      <figcaption className="text-xs text-zinc-500 dark:text-zinc-400">
        Seen from above. Ceiling height {formatMetres(height_m)} m.
      </figcaption>
    </figure>
  );
}
