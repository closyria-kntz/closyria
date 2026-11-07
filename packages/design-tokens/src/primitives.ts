/**
 * Layer 1: raw values. Never referenced by the UI directly; only semantic tokens read from here.
 * Palette C "chocolat et rose poudré" (docs/specs/2026-11-07-envies-chaleureuses.md, section 5.4);
 * `garnet` and `salmon` (danger) are derived, see theme.ts.
 */
export const primitives = {
  palette: {
    // Light
    oat: "#F2EDE7",
    white: "#FFFFFF",
    linen: "#EBE3DB",
    sand: "#E5D7CC",
    cocoa: "#2B1D17",
    ganache: "#4A332A",
    taupe: "#6E5A50",
    chocolate: "#5A3A2E",
    powder: "#EBC7C3",
    blush: "#F6E4E1",
    // A ticked row in « Préparer une commande ».
    petal: "#FBF3F1",
    rosewood: "#D8A9A3",
    milkChocolate: "#7A5444",
    butter: "#F3E3A6",
    latte: "#EADBC8",
    sage: "#D5DCC8",
    pine: "#1F4A3F",
    bronze: "#6A4F12",
    garnet: "#9B1C31",
    // Budget pills (version B): soft fills and edges.
    mint: "#E3F1E7",
    leaf: "#6FA58A",
    rosePetal: "#FBE3E6",
    coral: "#D97F8C",
    // Dark
    espresso: "#1E1612",
    mocha: "#2A201B",
    bark: "#241A15",
    umber: "#3D2F28",
    clay: "#C9B8AE",
    parchment: "#DDD0C6",
    stone: "#B5A398",
    dustyRose: "#6B4A44",
    roseBark: "#33251F",
    celadon: "#A9DCBF",
    spruce: "#1D3A31",
    gold: "#E8CF8F",
    olivewood: "#3A3220",
    salmon: "#F4A3A8",
    fern: "#4E8A6E",
    wine: "#4A2228",
    oldRose: "#B4646C",
  },
  space: {
    0: "0",
    1: "0.25rem",
    2: "0.5rem",
    3: "0.75rem",
    4: "1rem",
    5: "1.5rem",
    6: "2rem",
    7: "3rem",
    8: "4rem",
  },
  radius: { none: "0", sm: "0.25rem", md: "0.625rem", lg: "1.625rem", full: "9999px" },
  font: {
    body: '"DM Sans Variable", ui-sans-serif, system-ui, sans-serif',
    display: '"Fraunces Variable", ui-serif, Georgia, serif',
  },
  // Fluid: each size grows linearly from the 20rem phone width to `breakpoint.lg`, then stays put.
  fontSize: {
    caption: "0.8125rem",
    sm: "0.875rem",
    body: "clamp(1rem, 0.9432rem + 0.2841vw, 1.125rem)",
    lead: "clamp(1.25rem, 1.1364rem + 0.5682vw, 1.5rem)",
    title: "clamp(1.75rem, 1.4091rem + 1.7045vw, 2.5rem)",
    display: "clamp(2.5rem, 1.8182rem + 3.4091vw, 4rem)",
  },
  fontWeight: { regular: "400", medium: "500", strong: "600" },
  duration: { instant: "0ms", fast: "150ms", base: "250ms", slow: "400ms" },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasized: "cubic-bezier(0.3, 0, 0, 1.2)",
  },
  shadow: {
    soft: "0 1px 2px rgb(43 29 23 / 0.08)",
    lifted: "0 4px 12px rgb(43 29 23 / 0.12)",
  },
  breakpoint: { sm: "40rem", md: "48rem", lg: "64rem" },
  container: { narrow: "36rem", wide: "72rem", app: "90rem", measure: "70ch", sidebar: "15rem", panel: "42.5rem" },
  size: { touchTarget: "44px" },
} as const;
