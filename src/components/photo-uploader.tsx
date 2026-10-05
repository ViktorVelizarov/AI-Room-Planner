"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_TYPES, addPhotos } from "../shared/photo";

type Photo = { id: number; file: File; previewUrl: string };

const MB = 1024 * 1024;

function formatSize(bytes: number) {
  return bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / MB).toFixed(1)} MB`;
}

/** Lets the user pick up to 5 photos of their room, see them as thumbnails and remove any of them. */
export function PhotoUploader() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const nextId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const latestPhotos = useRef(photos);

  useEffect(() => {
    latestPhotos.current = photos;
  }, [photos]);

  // Free the preview images when the page is closed.
  useEffect(
    () => () => latestPhotos.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl)),
    [],
  );

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = ""; // so the same file can be chosen again after it was removed
    if (chosen.length === 0) return;

    const { accepted, notices } = addPhotos(photos.length, chosen);
    setNotices(notices);
    setPhotos([
      ...photos,
      ...accepted.map((file) => ({
        id: nextId.current++,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function handleRemove(photo: Photo) {
    URL.revokeObjectURL(photo.previewUrl);
    setPhotos(photos.filter((other) => other.id !== photo.id));
    setNotices([]);
  }

  return (
    <section
      aria-labelledby="photos-heading"
      className="flex flex-col gap-5 rounded-2xl border border-black/10 p-6 dark:border-white/15"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="photos-heading" className="text-lg font-semibold">
            Your room photos
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Add up to {MAX_PHOTOS} photos of the same room. JPG, PNG or WebP, up to{" "}
            {MAX_PHOTO_BYTES / MB} MB each.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Add photos
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={PHOTO_TYPES.join(",")}
          onChange={handleSelect}
          hidden
        />
      </div>

      {notices.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}

      {photos.length > 0 && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {photos.length} of {MAX_PHOTOS} photos added
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo) => (
              <li
                key={photo.id}
                className="overflow-hidden rounded-lg border border-black/10 dark:border-white/15"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, there is nothing to optimise */}
                <img
                  src={photo.previewUrl}
                  alt={`Preview of ${photo.file.name}`}
                  className="aspect-4/3 w-full object-cover"
                />
                <div className="flex flex-col gap-1.5 p-2 text-sm">
                  <p className="truncate" title={photo.file.name}>
                    {photo.file.name}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{formatSize(photo.file.size)}</p>
                    <button
                      type="button"
                      onClick={() => handleRemove(photo)}
                      aria-label={`Remove ${photo.file.name}`}
                      className="shrink-0 rounded-full border border-black/15 px-3 py-1 text-xs font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
