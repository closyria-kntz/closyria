const HEX = /^#[0-9A-Fa-f]{6}$/;

/** The stored hex when it is a valid `#RRGGBB`, else null (no swatch, text only). */
export function swatchHex(hex: string | null | undefined): string | null {
  return typeof hex === "string" && HEX.test(hex) ? hex : null;
}
