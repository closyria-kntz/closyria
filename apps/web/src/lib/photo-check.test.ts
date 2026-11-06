import { describe, expect, it } from "vitest";
import { checkPhoto, MAX_PHOTO_BYTES } from "./photo-check";

describe("checkPhoto", () => {
  it("accepts images up to 20 MB", () => {
    expect(checkPhoto({ type: "image/jpeg", size: MAX_PHOTO_BYTES })).toBeNull();
    expect(checkPhoto({ type: "", size: 10 })).toBeNull();
  });
  it("refuses other types and too heavy files", () => {
    expect(checkPhoto({ type: "application/pdf", size: 10 })).toBe("unsupported_image");
    expect(checkPhoto({ type: "image/png", size: MAX_PHOTO_BYTES + 1 })).toBe("image_too_large");
  });
});
