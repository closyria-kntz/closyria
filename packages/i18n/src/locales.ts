export const locales = ["fr", "en", "es"] as const;
export type Locale = (typeof locales)[number];

/** Locales shown to users; en and es are translated later. */
export const enabledLocales: readonly Locale[] = ["fr"];

export const defaultLocale: Locale = "fr";
