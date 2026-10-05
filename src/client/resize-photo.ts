/** Longest side, in pixels, of a photo sent for analysis. The model benchmark used the same size. */
export const MAX_PHOTO_SIDE = 1568;

const JPEG_QUALITY = 0.92;

/** The size a photo gets when it is shrunk to fit within `max` pixels on its longest side. Never enlarges. */
export function fitWithin(width: number, height: number, max = MAX_PHOTO_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Shrinks a photo for upload and saves it as a JPEG. A phone photo of several MB becomes a few
 * hundred KB, so five of them stay well under the request size Gemini accepts. Runs in the
 * browser. Rejects if the file cannot be decoded as an image.
 */
export async function preparePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("A canvas is not available");
    // Transparent areas of a PNG would turn black in a JPEG.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("The photo could not be saved as a JPEG");

    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, {
      type: "image/jpeg",
    });
  } finally {
    bitmap.close();
  }
}
