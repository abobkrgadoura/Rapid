const MAX_CHARS = 400_000;

/** Shrinks a screenshot or camera photo to a jpeg data URL the proof columns accept. */
export async function compressProofImage(file: File): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|heic)$/i.test(file.name)) {
    return null;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const first = canvas.toDataURL("image/jpeg", 0.72);
  if (first.length <= MAX_CHARS && first.startsWith("data:image/jpeg;base64,")) return first;
  const smaller = canvas.toDataURL("image/jpeg", 0.45);
  if (smaller.length <= MAX_CHARS && smaller.startsWith("data:image/jpeg;base64,")) {
    return smaller;
  }
  return null;
}
