/** Rules for an uploaded room photo. Shared so the upload page and the server check the same things. */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Photos of one room that can be added at once. */
export const MAX_PHOTOS = 5;

/**
 * The most photo data one request may carry. Gemini accepts 20 MB per request with images
 * sent inline, and base64 makes them a third bigger, so this stays well under that.
 */
export const MAX_TOTAL_PHOTO_BYTES = 14 * 1024 * 1024;

export type PhotoCheck =
  | { ok: true; type: PhotoType }
  | { ok: false; code: "invalid_photo" | "photo_too_large"; message: string };

export function checkPhoto(photo: { type: string; size: number }): PhotoCheck {
  const type = PHOTO_TYPES.find((t) => t === photo.type);
  if (!type) {
    return {
      ok: false,
      code: "invalid_photo",
      message: "Only JPG, PNG and WebP photos are supported.",
    };
  }
  if (photo.size === 0) {
    return { ok: false, code: "invalid_photo", message: "That photo is empty." };
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      code: "photo_too_large",
      message: `That photo is larger than ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`,
    };
  }
  return { ok: true, type };
}

/**
 * Decides which of the files just chosen join the photos already added. A file that breaks
 * the photo rules, or does not fit under MAX_PHOTOS, is left out and explained in `notices`.
 * Files are taken in the order given, so the first ones that fit are kept.
 */
export function addPhotos<T extends { name: string; type: string; size: number }>(
  alreadyAdded: number,
  chosen: T[],
): { accepted: T[]; notices: string[] } {
  const accepted: T[] = [];
  const notices: string[] = [];
  const noRoom: T[] = [];

  for (const file of chosen) {
    const check = checkPhoto(file);
    if (!check.ok) {
      notices.push(`"${file.name}" was not added. ${check.message}`);
    } else if (alreadyAdded + accepted.length >= MAX_PHOTOS) {
      noRoom.push(file);
    } else {
      accepted.push(file);
    }
  }

  if (noRoom.length === 1) {
    notices.push(`"${noRoom[0].name}" was not added. You can add up to ${MAX_PHOTOS} photos.`);
  } else if (noRoom.length > 1) {
    notices.push(`${noRoom.length} photos were not added. You can add up to ${MAX_PHOTOS} photos.`);
  }
  return { accepted, notices };
}

export type PhotoSetCheck =
  | { ok: true; types: PhotoType[] }
  | { ok: false; code: "invalid_photo" | "photo_too_large"; message: string };

/** Checks the photos of one request together: how many there are, each one, and their total size. */
export function checkPhotoSet(photos: { type: string; size: number }[]): PhotoSetCheck {
  if (photos.length === 0) {
    return { ok: false, code: "invalid_photo", message: "Send at least one photo to analyse." };
  }
  if (photos.length > MAX_PHOTOS) {
    return {
      ok: false,
      code: "invalid_photo",
      message: `You can send up to ${MAX_PHOTOS} photos at once.`,
    };
  }

  const types: PhotoType[] = [];
  for (const photo of photos) {
    const check = checkPhoto(photo);
    if (!check.ok) return check;
    types.push(check.type);
  }

  const total = photos.reduce((sum, photo) => sum + photo.size, 0);
  if (total > MAX_TOTAL_PHOTO_BYTES) {
    return {
      ok: false,
      code: "photo_too_large",
      message: `Together the photos are larger than ${MAX_TOTAL_PHOTO_BYTES / 1024 / 1024} MB.`,
    };
  }
  return { ok: true, types };
}
