import { z } from "zod";

/** Answer of `POST /api/media`: the stored photo, always WebP. */
export const uploadedMediaSchema = z.object({
  id: z.uuid(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  contentType: z.literal("image/webp"),
});
export type UploadedMedia = z.infer<typeof uploadedMediaSchema>;

/**
 * Stable error codes of the media routes. The web shows `Media.errors.<code>` from the message catalogs
 * (« Format non pris en charge », « Photo trop lourde, 20 Mo maximum »).
 */
export const mediaErrorCodes = ["unsupported_image", "image_too_large", "invalid_upload"] as const;
export const mediaErrorSchema = z.object({ error: z.enum(mediaErrorCodes) });
export type MediaErrorCode = (typeof mediaErrorCodes)[number];
