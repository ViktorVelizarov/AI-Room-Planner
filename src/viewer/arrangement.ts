import type { FurnitureItem } from "../shared/furniture";
import type { RoomSize } from "../shared/room";

/** Where a piece stands: the middle of its footprint, in metres from the middle of the floor (x across, z along the length). */
export type Placement = { x_m: number; z_m: number };

/** How far a row starts from the walls, and how far pieces are from each other, in metres. */
export const WALL_GAP_M = 0.1;
export const PIECE_GAP_M = 0.15;

/**
 * The simple arrangement shown until a layout has been made: the pieces in the order of the list,
 * side by side in a row along the back wall, starting at the left, with a small gap to the walls
 * and between the pieces. A piece that does not fit in what is left of a row starts the next row,
 * in front of the one before. A piece wider than the room has a row to itself, in the middle. If
 * the furniture does not fit the room, the rows go on past the front wall. The pieces face the
 * front of the room. The result has one place for each piece, in the same order.
 */
export function arrangeInRows(room: RoomSize, items: readonly FurnitureItem[]): Placement[] {
  const left = -room.width_m / 2 + WALL_GAP_M;
  const available = room.width_m - 2 * WALL_GAP_M;
  // The back edge of the row, and how deep the pieces in it are so far.
  let rowBack = -room.length_m / 2 + WALL_GAP_M;
  let rowDepth = 0;
  // Where the next piece of this row would start.
  let cursor = left;
  let rowHasPieces = false;

  const startNewRow = () => {
    rowBack += rowDepth + PIECE_GAP_M;
    rowDepth = 0;
    cursor = left;
    rowHasPieces = false;
  };

  return items.map((item) => {
    const width = item.width_cm / 100;
    const depth = item.depth_cm / 100;
    const tooWide = width > available;
    if (rowHasPieces && (tooWide || cursor + width > left + available)) startNewRow();

    // The back edges of the pieces in a row are in line, as furniture against a wall is.
    const placement = { x_m: tooWide ? 0 : cursor + width / 2, z_m: rowBack + depth / 2 };
    // A piece that is wider than the room moves the cursor past the end of the row, so the next piece wraps.
    cursor += width + PIECE_GAP_M;
    rowDepth = Math.max(rowDepth, depth);
    rowHasPieces = true;
    return placement;
  });
}
