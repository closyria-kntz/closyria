import { crc32 } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageTooLargeError, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, normalizeImage, UnsupportedImageError } from "./images";

const MB = 1024 * 1024;
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });

/** A JPEG as a phone writes it: EXIF with GPS position, camera, XMP and an ICC profile. */
async function jpegWithGps(orientation?: number): Promise<Buffer> {
  let image = solid(64, 48)
    .jpeg()
    .withExif({
      IFD0: { Make: "Apple", Model: "iPhone 17", Copyright: "Jeanne" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "48/1 51/1 2400/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "2/1 21/1 300/100",
      },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>')
    .withIccProfile("p3");
  if (orientation) image = image.withMetadata({ orientation });
  return image.toBuffer();
}

/** HEIC as written by an iPhone, reduced to its signature: `ftyp` box with the `heic` brand. */
function heicSignature(): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftypheic", 4, "latin1");
  ftyp.writeUInt32BE(0, 12);
  ftyp.write("mif1heic", 16, "latin1");
  return Buffer.concat([ftyp, Buffer.alloc(64)]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A decompression bomb: a few bytes of PNG that announce 50 000 × 50 000 pixels. */
function pngBomb(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(50_000, 0);
  ihdr.writeUInt32BE(50_000, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("normalizeImage", () => {
  it("keeps no metadata at all: no EXIF (GPS), no XMP, no ICC, no IPTC", async () => {
    const input = await jpegWithGps();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.exif?.includes(Buffer.from("iPhone 17"))).toBe(true);
    expect(before.xmp).toBeDefined();
    expect(before.icc).toBeDefined();

    const out = await normalizeImage(input);
    const after = await sharp(out.data).metadata();
    expect(after.format).toBe("webp");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(out.data.includes(Buffer.from("iPhone 17"))).toBe(false);
    expect(out).toMatchObject({ width: 64, height: 48, contentType: "image/webp" });
  });

  it("applies the EXIF orientation before dropping it", async () => {
    const out = await normalizeImage(await jpegWithGps(6)); // rotated 90°
    expect({ width: out.width, height: out.height }).toEqual({ width: 48, height: 64 });
    expect((await sharp(out.data).metadata()).orientation).toBeUndefined();
  });

  it("brings the longest side down to 2 048 px, and never enlarges", async () => {
    const big = await normalizeImage(await solid(3000, 1500).png().toBuffer());
    expect(MAX_IMAGE_SIDE).toBe(2048);
    expect({ width: big.width, height: big.height }).toEqual({ width: 2048, height: 1024 });
    const meta = await sharp(big.data).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 2048, height: 1024 });

    const small = await normalizeImage(await solid(300, 200).png().toBuffer());
    expect({ width: small.width, height: small.height }).toEqual({ width: 300, height: 200 });
  });

  it("accepts JPEG, PNG, WebP and AVIF, always returning WebP", async () => {
    for (const input of [
      await solid(40, 30).jpeg().toBuffer(),
      await solid(40, 30).png().toBuffer(),
      await solid(40, 30).webp().toBuffer(),
      await solid(40, 30).avif().toBuffer(),
    ]) {
      const out = await normalizeImage(input);
      expect(out.contentType).toBe("image/webp");
      expect((await sharp(out.data).metadata()).format).toBe("webp");
    }
  });

  it("refuses HEIC, which the server cannot decode", async () => {
    await expect(normalizeImage(heicSignature())).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it("refuses non-image files and other image formats", async () => {
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    for (const input of [
      pdf,
      svg,
      Buffer.alloc(0),
      Buffer.from("hello"),
      await solid(10, 10).gif().toBuffer(),
      await solid(10, 10).tiff().toBuffer(),
    ]) {
      await expect(normalizeImage(input)).rejects.toBeInstanceOf(UnsupportedImageError);
    }
  });

  it("refuses a damaged image cleanly", async () => {
    const jpeg = await solid(200, 200).jpeg().toBuffer();
    await expect(normalizeImage(jpeg.subarray(0, 300))).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it("refuses files over 20 MB", async () => {
    expect(MAX_IMAGE_BYTES).toBe(20 * MB);
    const input = Buffer.alloc(21 * MB);
    input.set([0xff, 0xd8, 0xff], 0);
    await expect(normalizeImage(input)).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("refuses decompression bombs before decoding them", async () => {
    await expect(normalizeImage(pngBomb())).rejects.toBeInstanceOf(ImageTooLargeError);
  });
});
