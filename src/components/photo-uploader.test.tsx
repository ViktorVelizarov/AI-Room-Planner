// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PHOTO_BYTES } from "../shared/photo";
import { PhotoUploader } from "./photo-uploader";

const createObjectURL = vi.fn((file: Blob) => `blob:preview/${(file as File).name}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  // jsdom has no object URLs.
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const photo = (name: string, type = "image/jpeg", size = 1000) =>
  new File([new Uint8Array(size)], name, { type });

// applyAccept off: the file picker would filter by type, but files also get past it
// (a different file type chosen via "All files", drag and drop), so the page must check too.
const setup = () => {
  const { container } = render(<PhotoUploader />);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const user = userEvent.setup({ applyAccept: false });
  const add = (...files: File[]) => user.upload(input, files);
  return { user, add, input };
};

const thumbnails = () => screen.queryAllByRole("img").map((img) => img.getAttribute("alt"));
const notices = () => screen.queryByRole("alert")?.textContent ?? null;

describe("PhotoUploader", () => {
  describe("adding photos", () => {
    it("starts with no photos and offers to add some", () => {
      setup();

      expect(thumbnails()).toEqual([]);
      expect(screen.getByRole("button", { name: "Add photos" })).toBeTruthy();
      expect(screen.getByText(/up to 5 photos/i)).toBeTruthy();
      expect(notices()).toBeNull();
    });

    it("opens the file picker when the Add photos button is pressed", async () => {
      const { user, input } = setup();
      const openPicker = vi.spyOn(input, "click");

      await user.click(screen.getByRole("button", { name: "Add photos" }));

      expect(openPicker).toHaveBeenCalledTimes(1);
    });

    it("only offers the supported photo types in the file picker", () => {
      const { input } = setup();

      expect(input.getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
      expect(input.hasAttribute("multiple")).toBe(true);
    });

    it("shows a thumbnail for each JPG, PNG and WebP photo chosen", async () => {
      const { add } = setup();

      await add(photo("a.jpg"), photo("b.png", "image/png"), photo("c.webp", "image/webp"));

      expect(thumbnails()).toEqual([
        "Preview of a.jpg",
        "Preview of b.png",
        "Preview of c.webp",
      ]);
      expect(screen.getByText("3 of 5 photos added")).toBeTruthy();
      expect(screen.getByRole("img", { name: "Preview of a.jpg" }).getAttribute("src")).toBe(
        "blob:preview/a.jpg",
      );
    });

    it("adds photos chosen in a later step to the ones already there", async () => {
      const { add } = setup();

      await add(photo("a.jpg"));
      await add(photo("b.jpg"), photo("c.jpg"));

      expect(thumbnails()).toHaveLength(3);
    });

    it("shows each photo's name and size", async () => {
      const { add } = setup();

      await add(photo("living-room.jpg", "image/jpeg", 2.5 * 1024 * 1024));

      expect(screen.getByText("living-room.jpg")).toBeTruthy();
      expect(screen.getByText("2.5 MB")).toBeTruthy();
    });
  });

  describe("removing photos", () => {
    it("removes only the photo whose button was pressed", async () => {
      const { user, add } = setup();
      await add(photo("a.jpg"), photo("b.jpg"), photo("c.jpg"));

      await user.click(screen.getByRole("button", { name: "Remove b.jpg" }));

      expect(thumbnails()).toEqual(["Preview of a.jpg", "Preview of c.jpg"]);
      expect(screen.getByText("2 of 5 photos added")).toBeTruthy();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview/b.jpg");
    });

    it("leaves nothing but the add button once every photo is removed", async () => {
      const { user, add } = setup();
      await add(photo("a.jpg"));

      await user.click(screen.getByRole("button", { name: "Remove a.jpg" }));

      expect(thumbnails()).toEqual([]);
      expect(screen.queryByText(/photos added/)).toBeNull();
    });

    it("lets the same file be chosen again after it was removed", async () => {
      const { user, add } = setup();
      const file = photo("a.jpg");
      await add(file);
      await user.click(screen.getByRole("button", { name: "Remove a.jpg" }));

      await add(file);

      expect(thumbnails()).toEqual(["Preview of a.jpg"]);
    });

    it("frees the previews when the page is closed", async () => {
      const { add } = setup();
      await add(photo("a.jpg"), photo("b.jpg"));

      cleanup(); // unmounts the component

      expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview/a.jpg");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview/b.jpg");
    });
  });

  describe("files that are not accepted", () => {
    it("rejects an unsupported file type with a message and keeps the other photos", async () => {
      const { add } = setup();
      await add(photo("a.jpg"));

      await add(photo("notes.gif", "image/gif"));

      expect(notices()).toBe(
        '"notes.gif" was not added. Only JPG, PNG and WebP photos are supported.',
      );
      expect(thumbnails()).toEqual(["Preview of a.jpg"]);
    });

    it("rejects a photo over 10 MB with a message and keeps the other photos", async () => {
      const { add } = setup();
      await add(photo("a.jpg"));

      await add(photo("huge.jpg", "image/jpeg", MAX_PHOTO_BYTES + 1));

      expect(notices()).toBe('"huge.jpg" was not added. That photo is larger than 10 MB.');
      expect(thumbnails()).toEqual(["Preview of a.jpg"]);
    });

    it("still adds the good files when some of the chosen ones are rejected", async () => {
      const { add } = setup();

      await add(photo("bad.pdf", "application/pdf"), photo("good.jpg"));

      expect(thumbnails()).toEqual(["Preview of good.jpg"]);
      expect(notices()).toContain('"bad.pdf" was not added.');
    });

    it("clears the message when a photo is removed", async () => {
      const { user, add } = setup();
      await add(photo("a.jpg"), photo("notes.gif", "image/gif"));
      expect(notices()).not.toBeNull();

      await user.click(screen.getByRole("button", { name: "Remove a.jpg" }));

      expect(notices()).toBeNull();
    });
  });

  describe("the limit of 5 photos", () => {
    const five = () => ["a", "b", "c", "d", "e"].map((n) => photo(`${n}.jpg`));

    it("tells the user the maximum and does not add a sixth photo", async () => {
      const { add } = setup();
      await add(...five());

      await add(photo("f.jpg"));

      expect(notices()).toBe('"f.jpg" was not added. You can add up to 5 photos.');
      expect(thumbnails()).toHaveLength(5);
      expect(thumbnails()).not.toContain("Preview of f.jpg");
    });

    it("adds what fits when more photos are chosen than there is room for", async () => {
      const { add } = setup();
      await add(photo("a.jpg"), photo("b.jpg"), photo("c.jpg"));

      await add(photo("d.jpg"), photo("e.jpg"), photo("f.jpg"), photo("g.jpg"));

      expect(thumbnails()).toHaveLength(5);
      expect(notices()).toBe("2 photos were not added. You can add up to 5 photos.");
    });

    it("makes room again once a photo is removed", async () => {
      const { user, add } = setup();
      await add(...five());
      await user.click(screen.getByRole("button", { name: "Remove a.jpg" }));

      await add(photo("f.jpg"));

      expect(thumbnails()).toHaveLength(5);
      expect(notices()).toBeNull();
    });
  });
});
