// Renders the provisional PWA icons (a "C" monogram in the token colours) until chantier 4.
// Run: pnpm --filter @closyria/web build:icons — the two PNGs are committed.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSemanticTokens } from "@closyria/design-tokens";
import sharp from "sharp";

const out = join(dirname(fileURLToPath(import.meta.url)), "../public/icons");
const background = defaultSemanticTokens["color-accent"];
const ink = defaultSemanticTokens["color-accent-ink"];

/** A full-bleed square (the OS masks it) with an open ring: a "C" that stays inside the maskable safe zone. */
export function monogramSvg(size: number): string {
  const radius = size * 0.26;
  const stroke = size * 0.09;
  const c = size / 2;
  const gap = Math.PI / 4; // half-opening of the "C", to the right
  const point = (angle: number) =>
    `${(c + radius * Math.cos(angle)).toFixed(2)} ${(c + radius * Math.sin(angle)).toFixed(2)}`;
  const arc = `M ${point(-gap)} A ${radius} ${radius} 0 1 0 ${point(gap)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${background}"/>
  <path d="${arc}" fill="none" stroke="${ink}" stroke-width="${stroke}" stroke-linecap="round"/>
</svg>`;
}

mkdirSync(out, { recursive: true });
for (const size of [192, 512]) {
  await sharp(Buffer.from(monogramSvg(size)))
    .png()
    .toFile(join(out, `icon-${size}.png`));
}
