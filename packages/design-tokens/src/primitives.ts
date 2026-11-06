/**
 * Layer 1: raw values. Never referenced by the UI directly; only semantic tokens read from here.
 * Palette: "Équilibré" visual direction (docs/specs/2026-11-01-direction-visuelle.md, section 3.1);
 * `garnet` and `salmon` (danger) are derived, see theme.ts.
 */
export const primitives = {
  palette: {
    // Light
    blush: "#F7F0ED",
    porcelain: "#FFFDFB",
    prune: "#2E1A2A",
    mauve: "#6F5A67",
    rosewater: "#E8DCD8",
    plum: "#7A2E5F",
    ivory: "#FFF6F0",
    pine: "#1F4A3F",
    mint: "#DCEBE2",
    bronze: "#6A4F12",
    champagne: "#F1E4C6",
    cream: "#F6EAD8",
    veil: "#EFE2DF",
    garnet: "#9B1C31",
    // Dark
    aubergine: "#1C1219",
    damson: "#261A23",
    petal: "#F6EBEE",
    heather: "#B9A3B0",
    mulberry: "#3A2A35",
    orchid: "#E7A6CB",
    sage: "#A9DCBF",
    spruce: "#1D3A31",
    gold: "#E8CF8F",
    olivewood: "#3A3220",
    umber: "#322A22",
    dusk: "#2F2129",
    salmon: "#F4A3A8",
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
  radius: { none: "0", sm: "0.25rem", md: "0.625rem", lg: "0.75rem", full: "9999px" },
  font: {
    body: '"Jost Variable", ui-sans-serif, system-ui, sans-serif',
    display: '"Cormorant Garamond Variable", ui-serif, Georgia, serif',
  },
  // Fluid: each size grows linearly from the 20rem phone width to `breakpoint.lg`, then stays put.
  fontSize: {
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
    soft: "0 1px 2px rgb(46 26 42 / 0.08)",
    lifted: "0 4px 12px rgb(46 26 42 / 0.12)",
  },
  breakpoint: { sm: "40rem", md: "48rem", lg: "64rem" },
  container: { narrow: "36rem", wide: "72rem", app: "90rem", measure: "70ch", sidebar: "15rem", paste: "35rem" },
  size: { touchTarget: "44px" },
} as const;
