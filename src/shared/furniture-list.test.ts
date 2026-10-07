import { describe, expect, it } from "vitest";
import { typicalItem, type FurnitureItem } from "./furniture";
import { addEntry, removeEntry, toEntries, toItems, updateEntry } from "./furniture-list";

const sofa: FurnitureItem = { label: "sofa", width_cm: 200, depth_cm: 90, height_cm: 85, color: "grey", material: "fabric" };
const desk: FurnitureItem = { label: "desk", width_cm: 120, depth_cm: 60, height_cm: 75, color: "oak", material: "wood" };
const rug: FurnitureItem = { label: "rug", width_cm: 200, depth_cm: 300, height_cm: 2, color: "beige", material: "fabric" };

describe("the working list of furniture", () => {
  it("starts as the furniture the AI found, each piece with its own id", () => {
    const entries = toEntries([sofa, desk, rug]);

    expect(entries.map((entry) => entry.item)).toEqual([sofa, desk, rug]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);
    expect(toItems(entries)).toEqual([sofa, desk, rug]);
  });

  it("can start empty", () => {
    expect(toEntries([])).toEqual([]);
  });

  describe("removing a piece", () => {
    it("takes out only that piece", () => {
      const entries = toEntries([sofa, desk, rug]);

      expect(toItems(removeEntry(entries, entries[1].id))).toEqual([sofa, rug]);
    });

    it("leaves the list alone when there is no such piece", () => {
      const entries = toEntries([sofa]);

      expect(removeEntry(entries, 99)).toEqual(entries);
    });

    it("does not change the list it was given", () => {
      const entries = toEntries([sofa, desk]);

      removeEntry(entries, entries[0].id);

      expect(entries).toHaveLength(2);
    });
  });

  describe("adding a piece", () => {
    it("adds the type with its typical size at the end", () => {
      const entries = addEntry(toEntries([sofa]), "desk");

      expect(entries).toHaveLength(2);
      expect(entries[0].item).toEqual(sofa);
      expect(entries[1].item).toEqual(typicalItem("desk"));
      expect(entries[1].item.width_cm).toBe(120);
    });

    it("works on an empty list", () => {
      expect(toItems(addEntry([], "bed"))).toEqual([typicalItem("bed")]);
    });

    it("gives every piece its own id, even after some were removed", () => {
      let entries = toEntries([sofa, desk, rug]);
      entries = removeEntry(entries, entries[1].id);
      entries = addEntry(entries, "bed");
      entries = addEntry(entries, "bed");

      const ids = entries.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("changing a piece", () => {
    it("replaces that piece in place and leaves the others", () => {
      const entries = toEntries([sofa, desk, rug]);
      const changed = { ...desk, label: "dining_table" as const, width_cm: 150 };

      const result = updateEntry(entries, entries[1].id, changed);

      expect(toItems(result)).toEqual([sofa, changed, rug]);
      expect(result.map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
    });

    it("does not change the list it was given", () => {
      const entries = toEntries([sofa]);

      updateEntry(entries, entries[0].id, { ...sofa, width_cm: 300 });

      expect(entries[0].item.width_cm).toBe(200);
    });
  });
});
