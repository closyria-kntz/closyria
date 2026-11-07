// Réglages → Apparence, applied before the first paint (no flash). Same key and ids as src/lib/theme-mode.ts.
try {
  const id = { light: "equilibre-light", dark: "equilibre-dark" }[localStorage.getItem("closyria-theme")];
  if (id) document.documentElement.setAttribute("data-theme", id);
} catch {}
