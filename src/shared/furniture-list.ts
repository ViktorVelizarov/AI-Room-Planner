import { typicalItem, type FurnitureItem, type FurnitureLabel } from "./furniture";

/** One piece in the list the user is working on. The id keeps track of it as the list changes. */
export type FurnitureEntry = { id: number; item: FurnitureItem };

/** The list to start from: the furniture the AI found. */
export function toEntries(items: FurnitureItem[]): FurnitureEntry[] {
  return items.map((item, id) => ({ id, item }));
}

export const toItems = (entries: FurnitureEntry[]): FurnitureItem[] =>
  entries.map((entry) => entry.item);

const nextId = (entries: FurnitureEntry[]) =>
  Math.max(-1, ...entries.map((entry) => entry.id)) + 1;

/** Adds a piece of the given type, with its typical size, at the end of the list. */
export function addEntry(entries: FurnitureEntry[], label: FurnitureLabel): FurnitureEntry[] {
  return [...entries, { id: nextId(entries), item: typicalItem(label) }];
}

export function removeEntry(entries: FurnitureEntry[], id: number): FurnitureEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

/** Replaces one piece, keeping its place in the list. */
export function updateEntry(
  entries: FurnitureEntry[],
  id: number,
  item: FurnitureItem,
): FurnitureEntry[] {
  return entries.map((entry) => (entry.id === id ? { id, item } : entry));
}
