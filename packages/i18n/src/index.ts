import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import { defaultLocale, type Locale } from "./locales";

export { defaultLocale, enabledLocales, type Locale, locales } from "./locales";

export type Messages = typeof fr;

type Tree = { [key: string]: string | Tree };

const catalogs: Record<Locale, Tree> = { fr, en, es };

function merge(base: Tree, override: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = typeof value === "object" && typeof current === "object" ? merge(current, value) : value;
  }
  return out;
}

/** Messages for a locale; keys missing from it fall back to French. */
export function loadMessages(locale: Locale): Messages {
  return merge(catalogs[defaultLocale], catalogs[locale]) as Messages;
}
