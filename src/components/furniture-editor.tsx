"use client";

import { useEffect, useRef, useState } from "react";
import {
  FURNITURE_LABELS,
  FURNITURE_NAMES,
  type FurnitureItem,
  type FurnitureLabel,
} from "../shared/furniture";
import {
  addEntry,
  removeEntry,
  updateEntry,
  type FurnitureEntry,
} from "../shared/furniture-list";
import { SelectField } from "./form-fields";
import { UnsupportedNote } from "./furniture-list";
import { FurnitureItemForm } from "./furniture-item-form";

const cm = (n: number) => Math.round(n);

const sizeText = (item: FurnitureItem) =>
  `${cm(item.width_cm)} × ${cm(item.depth_cm)} × ${cm(item.height_cm)} cm`;

const addOptions = [
  { value: "", label: "Choose a type" },
  ...FURNITURE_LABELS.map((label) => ({ value: label, label: FURNITURE_NAMES[label] })),
];

const SECONDARY_BUTTON =
  "rounded-full border border-black/15 px-3 py-1 text-xs font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/20 dark:hover:bg-white/10";

/**
 * The furniture in the room, which the user can correct: remove a piece that is wrong or
 * doubled, add one the AI missed, and change a piece's type, size, colour or material.
 */
export function FurnitureEditor({
  entries,
  unsupported,
  onChange,
}: {
  entries: FurnitureEntry[];
  /** How many things the AI found that are not a supported type. */
  unsupported: number;
  onChange: (entries: FurnitureEntry[]) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newType, setNewType] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const editButtons = useRef(new Map<number, HTMLButtonElement>());
  const returnFocusTo = useRef<number | null>(null);

  // After saving or cancelling, the form is gone: put the focus back on the piece's Edit button.
  useEffect(() => {
    if (editingId === null && returnFocusTo.current !== null) {
      editButtons.current.get(returnFocusTo.current)?.focus();
      returnFocusTo.current = null;
    }
  }, [editingId]);

  function finishEditing(id: number) {
    returnFocusTo.current = id;
    setEditingId(null);
  }

  function handleRemove(entry: FurnitureEntry) {
    onChange(removeEntry(entries, entry.id));
    setAnnouncement(`Removed ${FURNITURE_NAMES[entry.item.label]}.`);
    heading.current?.focus(); // the button that was pressed is gone
  }

  function handleAdd() {
    if (newType === "") return;
    const label = newType as FurnitureLabel;
    onChange(addEntry(entries, label));
    setAnnouncement(`Added ${FURNITURE_NAMES[label]} with a typical size.`);
    setNewType("");
  }

  function handleSave(entry: FurnitureEntry, item: FurnitureItem) {
    onChange(updateEntry(entries, entry.id, item));
    setAnnouncement(`Saved ${FURNITURE_NAMES[item.label]}.`);
    finishEditing(entry.id);
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">
        Furniture in your room ({entries.length})
      </h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Sizes are estimates: width × depth × height. Correct anything the AI got wrong.
      </p>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-zinc-600 dark:border-white/15 dark:text-zinc-400">
          There is no furniture in the list. Add the pieces that are in your room.
        </p>
      ) : (
        <ul className="divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 dark:divide-white/15 dark:border-white/15">
          {entries.map((entry) => {
            const name = FURNITURE_NAMES[entry.item.label];
            const description = `${name} (${sizeText(entry.item)})`;
            return (
              <li key={entry.id}>
                {editingId === entry.id ? (
                  <FurnitureItemForm
                    item={entry.item}
                    onSave={(item) => handleSave(entry, item)}
                    onCancel={() => finishEditing(entry.id)}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{name}</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {entry.item.color} · {entry.item.material}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <p className="text-sm tabular-nums">{sizeText(entry.item)}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          ref={(element) => {
                            if (element) editButtons.current.set(entry.id, element);
                            else editButtons.current.delete(entry.id);
                          }}
                          onClick={() => setEditingId(entry.id)}
                          aria-label={`Edit ${description}`}
                          className={SECONDARY_BUTTON}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(entry)}
                          aria-label={`Remove ${description}`}
                          className={SECONDARY_BUTTON}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <UnsupportedNote count={unsupported} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 sm:flex-none">
          <SelectField
            id="add-furniture-type"
            label="Add a piece the AI missed"
            value={newType}
            onChange={setNewType}
            options={addOptions}
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={newType === ""}
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add furniture
        </button>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
