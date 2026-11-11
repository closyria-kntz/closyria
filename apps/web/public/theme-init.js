// Réglages → Apparence, applied before the first paint (no flash). Same key and ids as src/lib/theme-mode.ts.
try {
  const id = { light: "boudoir-light", dark: "boudoir-dark" }[localStorage.getItem("closyria-theme")];
  if (id) document.documentElement.setAttribute("data-theme", id);
} catch {}
