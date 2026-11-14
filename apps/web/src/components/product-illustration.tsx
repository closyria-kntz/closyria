import type { CatalogIllustration, IllustrationKind } from "@closyria/shared";
import { SwatchGroup } from "@/components/color-swatch";
import { swatchHex } from "@/lib/swatch-hex";

// Catalogue conforme (docs/specs/2026-11-14-catalogue-conforme.md): what « Découvrir » draws instead of a shop's photo
// when the shop gave no listing agreement. One Closyria silhouette per kind of article (viewBox 120 × 160, the 3:4 of
// the photos), filled with the article's colour (a neutral tint when unknown), outlined in ink so that a white or very
// pale piece still reads on the powder-pink backdrop, in light and dark. The drawings are fitted above y = 118, where
// the card lays « Je le veux ». Purely decorative: the article's name is the label.

/** `details` lie on the fill (their stroke contrasts with it); `outline` lies outside it, in ink like the contour. */
type Shape = { body: string; details?: string[]; outline?: string[]; hook?: boolean };

/** A coat hanger's hook above the garments that hang. */
const HOOK = "M60 34 V25 a5 5 0 1 1 5 -5";

/** Drawn in a 120 × 148 frame, then fitted: y 14…144 lands on 15…116 (the bottom stays clear of « Je le veux »). */
const FIT = "translate(13.2 4) scale(0.78)";

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
  // A sneaker seen from the side: toe on the right, a flat sole, laces on the instep.
  shoes: {
    body: "M12 140 V118 Q12 100 28 96 L44 88 Q50 104 66 104 Q78 104 84 96 L100 108 Q112 116 110 130 V140 Z",
    details: ["M12 130 H110", "M48 114 L56 106", "M58 116 L66 108", "M68 116 L76 108"],
  },
  bag: {
    body: "M28 70 Q28 62 36 62 L84 62 Q92 62 92 70 L96 124 Q96 132 88 132 L32 132 Q24 132 24 124 Z",
    details: ["M24 84 L96 84", "M56 84 L56 92 L64 92 L64 84"],
    outline: ["M44 62 Q44 36 60 36 Q76 36 76 62"],
  },
  // A wide-brimmed hat seen from the front: crown, ribbon and brim (scarves, hats, jewellery and belts).
  accessory: {
    body: "M10 112 Q10 100 34 97 Q34 64 60 62 Q86 64 86 97 Q110 100 110 112 Q110 124 60 124 Q10 124 10 112 Z",
    details: ["M35 88 Q60 95 85 88", "M35 97 Q60 104 85 97", "M24 110 Q60 120 96 110"],
  },
  other: {
    body: "M30 64 L60 46 L90 64 L90 128 L30 128 Z",
    details: ["M30 64 L90 64", "M44 80 L76 80"],
    hook: true,
  },
};

/** Relative luminance of a `#RRGGBB` (WCAG): what decides whether the detail lines are light or dark. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

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
  const hex = swatchHex(illustration.color);
  // Light lines on a dark fill (black bag, navy trousers), dark lines on a light one: never lost in the fill.
  const detail = hex && luminance(hex) < 0.2 ? "stroke-figure-detail-on-dark" : "stroke-figure-detail-on-light";
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
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <g transform={FIT}>
          {shape.hook && <path d={HOOK} className="fill-none" />}
          {shape.outline?.map((d) => (
            <path key={d} d={d} className="fill-none" />
          ))}
          <SwatchGroup hex={hex}>
            <path d={shape.body} className={hex ? "fill-(--swatch)" : "fill-figure-neutral"} />
          </SwatchGroup>
          {shape.details?.map((d) => (
            <path key={d} d={d} className={`fill-none ${detail}`} strokeWidth="1.6" />
          ))}
        </g>
      </svg>
    </span>
  );
}
