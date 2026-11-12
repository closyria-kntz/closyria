/**
 * Layer 1: raw values. Never referenced by the UI directly; only semantic tokens read from here.
 * Boudoir (docs/specs/2026-11-11-refonte-boudoir.md, section 4; dark values validated on 2026-11-11) leads; the
 * older entries still feed success, danger, premium and the budget pills until they are migrated.
 */
export const primitives = {
  palette: {
    // Boudoir, light
    cream: "#FBF7F4",
    boudoirInk: "#2B1418",
    // The mockup's #86686D, darkened in the same hue for AA (4.5:1) on the soft, chip and powder fills.
    mauveGrey: "#755A5F",
    rosyLine: "#ECDCD9",
    softRose: "#F6E6E3",
    chipRose: "#F1E4E1",
    powderRose: "#F3D6DA",
    burgundy: "#5B1A2A",
    burgundyAccent: "#8C2A3C",
    ochre: "#D9A441",
    tipCream: "#FFF1D6",
    tipBrown: "#5A3D00",
    // Boudoir, dark
    nightBurgundy: "#1C0F12",
    nightInk: "#F6E9EA",
    nightMuted: "#C2A6AB",
    nightLine: "#43282E",
    nightCard: "#2A171B",
    nightSoft: "#351D22",
    nightUne: "#4A2730",
    nightBand: "#3A1119",
    nightRose: "#F0A9B6",
    nightTip: "#3A2E12",
    nightTipInk: "#F5DFA8",
    // Success, premium and danger (kept from before Boudoir), light
    white: "#FFFFFF",
    butter: "#F3E3A6",
    sage: "#D5DCC8",
    pine: "#1F4A3F",
    bronze: "#6A4F12",
    garnet: "#9B1C31",
    // Budget pills (version B): soft fills and edges.
    mint: "#E3F1E7",
    leaf: "#6FA58A",
    rosePetal: "#FBE3E6",
    coral: "#D97F8C",
    // …and dark
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
  radius: {
    none: "0",
    sm: "0.25rem",
    md: "0.625rem",
    card: "1.25rem",
    pill: "999px",
    full: "9999px",
  },
  font: {
    body: '"Figtree Variable", ui-sans-serif, system-ui, sans-serif',
    title: '"Gloock", ui-serif, Georgia, serif',
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
    soft: "0 1px 2px rgb(43 20 24 / 0.08)",
    lifted: "0 4px 12px rgb(43 20 24 / 0.12)",
  },
  breakpoint: { sm: "40rem", md: "48rem", lg: "64rem" },
  container: { narrow: "36rem", wide: "72rem", app: "90rem", measure: "70ch", sidebar: "15rem", panel: "42.5rem" },
  size: { touchTarget: "44px" },
} as const;
