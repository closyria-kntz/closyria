import { swatchHex } from "@/lib/swatch-hex";

/**
 * A small preview of a stored colour. The hex is data (admin-edited), not a design value: this is the one
 * place allowed to set a colour from data, as a CSS custom property read by a token-based class (the only
 * file exempted in scripts/check-design-tokens.ts). An invalid hex renders nothing, only the text beside it.
 */
export function ColorSwatch({ hex }: { hex: string | null | undefined }) {
  const valid = swatchHex(hex);
  if (!valid) return null;
  return (
    <span
      aria-hidden="true"
      data-swatch={valid}
      style={{ "--swatch": valid } as React.CSSProperties}
      className="inline-block size-space-4 shrink-0 rounded-full border border-line bg-(--swatch)"
    />
  );
}
