/** Same ceiling as the API (20 MB): refused here first so the photo is not uploaded for nothing. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/** The API error code to show for a file that cannot be a photo, or null. An unknown type is left to the API. */
export function checkPhoto(file: { type: string; size: number }): "unsupported_image" | "image_too_large" | null {
  if (file.type !== "" && !file.type.startsWith("image/")) return "unsupported_image";
  if (file.size > MAX_PHOTO_BYTES) return "image_too_large";
  return null;
}
