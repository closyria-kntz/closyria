import sharp, { type Metadata } from "sharp";

/** Largest photo accepted, before re-encoding (« Photo trop lourde, 20 Mo maximum »). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Longest side of a stored photo. */
export const MAX_IMAGE_SIDE = 2048;
/** Decoded size above which an image is refused (decompression bombs): 100 megapixels. */
export const MAX_IMAGE_PIXELS = 100_000_000;

/** Not a JPEG, PNG, WebP or AVIF image (HEIC included: the server has no HEVC decoder), or damaged. */
export class UnsupportedImageError extends Error {
  override readonly name = "UnsupportedImageError";
  constructor() {
    super("unsupported image");
  }
}

/** Over 20 MB, or more pixels than `MAX_IMAGE_PIXELS`. */
export class ImageTooLargeError extends Error {
  override readonly name = "ImageTooLargeError";
  constructor() {
    super("image too large");
  }
}

export type NormalizedImage = { data: Buffer; width: number; height: number; contentType: "image/webp" };

type Format = "jpeg" | "png" | "webp" | "avif";

/** Format from the first bytes; the client's file name and Content-Type are never trusted. */
function sniff(input: Buffer): Format | null {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return "jpeg";
  if (input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (input.toString("latin1", 0, 4) === "RIFF" && input.toString("latin1", 8, 12) === "WEBP") return "webp";
  // ISO-BMFF: `ftyp` box with the AVIF brand, as major or compatible brand. HEIC (`heic`, `heix`, `mif1` only…) is not.
  if (input.length >= 16 && input.toString("latin1", 4, 8) === "ftyp") {
    const size = Math.min(input.readUInt32BE(0), input.length);
    const brands = [input.toString("latin1", 8, 12)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(input.toString("latin1", i, i + 4));
    if (brands.includes("avif") || brands.includes("avis")) return "avif";
  }
  return null;
}

/**
 * Re-encodes a photo for storage: EXIF orientation applied, longest side at most 2 048 px, WebP,
 * and no metadata kept (EXIF with GPS, XMP, IPTC, ICC: spec §9).
 * Throws `ImageTooLargeError` or `UnsupportedImageError`; never anything else for bad input.
 */
export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  if (input.length > MAX_IMAGE_BYTES) throw new ImageTooLargeError();
  const format = sniff(input);
  if (!format) throw new UnsupportedImageError();

  const options = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" } as const;
  let meta: Metadata;
  try {
    // Header only, nothing decoded: the pixel limit is checked below, so a bomb gets the right error.
    meta = await sharp(input, { ...options, limitInputPixels: false }).metadata();
  } catch {
    throw new UnsupportedImageError();
  }
  // libvips agrees on the format (AVIF is `heif` compressed with AV1; HEIC is `heif` with HEVC).
  const decoded = meta.format === "heif" ? (meta.compression === "av1" ? "avif" : null) : meta.format;
  if (decoded !== format) throw new UnsupportedImageError();
  if (!meta.width || !meta.height) throw new UnsupportedImageError();
  if (meta.width * meta.height > MAX_IMAGE_PIXELS) throw new ImageTooLargeError();

  try {
    // sharp writes no metadata unless asked (withMetadata/keep*): the output carries none of the input's.
    const { data, info } = await sharp(input, options)
      .autoOrient()
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, contentType: "image/webp" };
  } catch {
    throw new UnsupportedImageError();
  }
}
