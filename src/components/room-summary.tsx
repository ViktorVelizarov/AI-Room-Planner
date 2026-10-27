"use client";

import { useState } from "react";
import { toItems, type FurnitureEntry } from "../shared/furniture-list";
import { formatMetres, type RoomSize } from "../shared/room";
import { createRoomDescription, type RoomDescription } from "../shared/room-description";
import { FurnitureEditor } from "./furniture-editor";

/**
 * The room as it stands: its size, and its furniture, which the user can correct. Continuing
 * turns the two into the room description, if they are complete.
 */
export function RoomSummary({
  size,
  entries,
  unsupported,
  onEntriesChange,
  onBack,
  onConfirm,
}: {
  size: RoomSize;
  entries: FurnitureEntry[];
  unsupported: number;
  onEntriesChange: (entries: FurnitureEntry[]) => void;
  onBack: () => void;
  /** Called with the room description, only when the size and the furniture list are complete. */
  onConfirm: (description: RoomDescription) => void;
}) {
  // How many times Continue was pressed without success. From the first one on, the message
  // follows the list as the user fixes it. The count also restarts the message, so a screen
  // reader reads it again when Continue is pressed again and nothing has changed.
  const [failedAttempts, setFailedAttempts] = useState(0);

  const result = createRoomDescription(size, toItems(entries));
  const problems = failedAttempts > 0 && !result.ok ? result.problems : [];

  function handleContinue() {
    if (result.ok) {
      setFailedAttempts(0);
      onConfirm(result.description);
    } else {
      setFailedAttempts(failedAttempts + 1);
    }
  }

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

      {problems.length > 0 && (
        <div
          key={failedAttempts}
          role="alert"
          className="flex flex-col gap-1 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/20 dark:hover:bg-white/10"
        >
          Back to room size
        </button>
        <button
          type="button"
          onClick={handleContinue}
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Continue to 3D room
        </button>
      </div>
    </section>
  );
}
