import { describe, expect, it } from "vitest";
import { swatchHex } from "./swatch-hex";

const valid = `#${"12ab"}ef`;

describe("swatchHex", () => {
  it("keeps a valid hex", () => {
    expect(swatchHex(valid)).toBe(valid);
  });

  it.each(["red", valid.slice(0, 5), `${valid}ff`, "url(x)", "", null, undefined])("rejects %s", (hex) => {
    expect(swatchHex(hex)).toBeNull();
  });
});
