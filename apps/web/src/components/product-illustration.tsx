import type { CatalogIllustration, IllustrationKind } from "@closyria/shared";
import { SwatchGroup } from "@/components/color-swatch";
import { swatchHex } from "@/lib/swatch-hex";

// Catalogue conforme (docs/specs/2026-11-14-catalogue-conforme.md): what « Découvrir » draws instead of a shop's photo
// when the shop gave no listing agreement. One Closyria silhouette per kind of article (viewBox 120 × 160, the 3:4 of
// the photos), filled with the article's colour (neutral when unknown), outlined in ink so that a white or very pale
// piece still reads on the powder-pink backdrop, in light and dark. Purely decorative: the article's name is the label.

type Shape = { body: string; details?: string[]; hook?: boolean };

/** A coat hanger's hook above the garments that hang. */
const HOOK = "M60 34 V25 a5 5 0 1 1 5 -5";

const SHAPES: Record<IllustrationKind, Shape> = {
  top: {
    body: "M48 34 Q60 44 72 34 L88 40 L104 62 L92 72 L84 64 L84 128 L36 128 L36 64 L28 72 L16 62 L32 40 Z",
    details: ["M48 34 Q60 52 72 34"],
    hook: true,
  },
  dress: {
    body: "M50 32 L54 32 Q60 40 66 32 L70 32 L72 56 Q68 64 72 72 L96 134 Q60 144 24 134 L48 72 Q52 64 48 56 Z",
    details: ["M48 72 Q60 78 72 72", "M42 100 Q60 106 78 100"],
    hook: true,
  },
  bottom: {
    body: "M38 32 L82 32 L88 136 L66 136 L60 70 L54 136 L32 136 Z",
    details: ["M38 42 L82 42", "M60 42 L60 56"],
  },
  skirt: {
    body: "M42 44 L78 44 L96 124 Q60 134 24 124 Z",
    details: ["M42 54 L78 54", "M54 56 L46 126", "M66 56 L74 126"],
  },
  coat: {
    body: "M42 32 L52 28 L60 46 L68 28 L78 32 L98 52 L100 128 L88 128 L86 76 L86 136 L34 136 L34 76 L32 128 L20 128 L22 52 Z",
    details: ["M60 46 L60 136", "M52 28 L56 60 L60 46", "M68 28 L64 60 L60 46"],
    hook: true,
  },
  shoes: {
    body: "M24 96 Q26 80 38 78 L48 78 Q56 94 78 98 L96 102 Q104 108 98 114 L46 114 L44 128 L36 128 L34 114 Q22 110 24 96 Z",
    details: ["M48 78 Q46 92 34 98"],
  },
  bag: {
    body: "M28 70 Q28 62 36 62 L84 62 Q92 62 92 70 L96 124 Q96 132 88 132 L32 132 Q24 132 24 124 Z",
    details: ["M44 62 Q44 36 60 36 Q76 36 76 62", "M24 84 L96 84", "M56 84 L56 92 L64 92 L64 84"],
  },
  other: {
    body: "M30 64 L60 46 L90 64 L90 128 L30 128 Z",
    details: ["M30 64 L90 64", "M44 80 L76 80"],
    hook: true,
  },
};

/**
 * The illustration of a catalogue article: its kind's silhouette in its colour on the soft backdrop, the size of its
 * frame (`className`, e.g. `aspect-3/4 size-full`). `aria-hidden`: the card or the sheet names the article.
 */
export function ProductIllustration({
  illustration,
  className = "",
}: {
  illustration: CatalogIllustration;
  className?: string;
}) {
  const shape = SHAPES[illustration.kind] ?? SHAPES.other;
  const filled = swatchHex(illustration.color) !== null;
  return (
    <span
      aria-hidden="true"
      data-testid="product-illustration"
      data-kind={illustration.kind}
      className={`${className} flex items-center justify-center bg-media-backdrop`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 120 160"
        focusable="false"
        className="size-full stroke-ink"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {shape.hook && <path d={HOOK} className="fill-none" />}
        <SwatchGroup hex={illustration.color}>
          <path d={shape.body} className={filled ? "fill-(--swatch)" : "fill-surface-strong"} />
        </SwatchGroup>
        {shape.details?.map((d) => (
          <path key={d} d={d} className="fill-none opacity-50" />
        ))}
      </svg>
    </span>
  );
}
