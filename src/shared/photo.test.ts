import { describe, expect, it } from "vitest";
import { MAX_PHOTOS, MAX_PHOTO_BYTES, addPhotos, checkPhoto } from "./photo";

describe("checkPhoto", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s", (type) => {
    expect(checkPhoto({ type, size: 1000 })).toEqual({ ok: true, type });
  });

  it("accepts a photo exactly at the size limit", () => {
    expect(checkPhoto({ type: "image/png", size: MAX_PHOTO_BYTES }).ok).toBe(true);
  });

  it.each(["image/gif", "application/pdf", "text/html", ""])(
    "rejects the type %j",
    (type) => {
      expect(checkPhoto({ type, size: 1000 })).toMatchObject({
        ok: false,
        code: "invalid_photo",
        message: "Only JPG, PNG and WebP photos are supported.",
      });
    },
  );

  it("rejects a photo over the size limit", () => {
    expect(checkPhoto({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toEqual({
      ok: false,
      code: "photo_too_large",
      message: "That photo is larger than 10 MB.",
    });
  });

  it("rejects an empty file", () => {
    expect(checkPhoto({ type: "image/jpeg", size: 0 })).toMatchObject({
      ok: false,
      code: "invalid_photo",
    });
  });
});

describe("addPhotos", () => {
  const file = (name: string, type = "image/jpeg", size = 1000) => ({ name, type, size });

  it("accepts photos that follow the rules", () => {
    const chosen = [file("a.jpg"), file("b.png", "image/png"), file("c.webp", "image/webp")];

    expect(addPhotos(0, chosen)).toEqual({ accepted: chosen, notices: [] });
  });

  it("allows up to 5 photos in total", () => {
    expect(MAX_PHOTOS).toBe(5);
    const chosen = ["a", "b", "c", "d", "e"].map((n) => file(`${n}.jpg`));

    expect(addPhotos(0, chosen).accepted).toHaveLength(5);
  });

  it("leaves out a file of the wrong type and says why, keeping the rest", () => {
    const good = file("a.jpg");

    expect(addPhotos(0, [file("notes.gif", "image/gif"), good])).toEqual({
      accepted: [good],
      notices: ['"notes.gif" was not added. Only JPG, PNG and WebP photos are supported.'],
    });
  });

  it("leaves out a file over the size limit", () => {
    const result = addPhotos(0, [file("huge.jpg", "image/jpeg", MAX_PHOTO_BYTES + 1)]);

    expect(result.accepted).toEqual([]);
    expect(result.notices).toEqual(['"huge.jpg" was not added. That photo is larger than 10 MB.']);
  });

  it("names the maximum when one more photo does not fit", () => {
    expect(addPhotos(5, [file("f.jpg")])).toEqual({
      accepted: [],
      notices: ['"f.jpg" was not added. You can add up to 5 photos.'],
    });
  });

  it("adds what fits, in order, and counts the rest in one message", () => {
    const chosen = ["a", "b", "c", "d"].map((n) => file(`${n}.jpg`));

    const result = addPhotos(3, chosen);

    expect(result.accepted).toEqual([chosen[0], chosen[1]]);
    expect(result.notices).toEqual(["2 photos were not added. You can add up to 5 photos."]);
  });

  it("does not let a rejected file use up room", () => {
    const good = [file("a.jpg"), file("b.jpg")];

    const result = addPhotos(3, [file("x.gif", "image/gif"), ...good]);

    expect(result.accepted).toEqual(good);
    expect(result.notices).toHaveLength(1);
  });
});
