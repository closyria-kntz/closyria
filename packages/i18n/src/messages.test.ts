import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import { defaultLocale, enabledLocales, loadMessages } from "./index";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const catalogs: Record<string, Tree> = { fr, en, es };
const frKeys = Object.keys(flatten(fr));

describe("message catalogs", () => {
  it("has every French key in each enabled locale", () => {
    for (const locale of enabledLocales) {
      const keys = Object.keys(flatten(catalogs[locale] ?? {}));
      expect(
        frKeys.filter((k) => !keys.includes(k)),
        locale,
      ).toEqual([]);
    }
  });

  it("has no orphan key in en or es", () => {
    for (const locale of ["en", "es"]) {
      const keys = Object.keys(flatten(catalogs[locale] ?? {}));
      expect(
        keys.filter((k) => !frKeys.includes(k)),
        locale,
      ).toEqual([]);
    }
  });

  it("compiles every message as ICU", () => {
    for (const [locale, tree] of Object.entries(catalogs)) {
      for (const [key, message] of Object.entries(flatten(tree))) {
        expect(() => new IntlMessageFormat(message, locale), `${locale}:${key}`).not.toThrow();
      }
    }
  });
});

describe("loadMessages", () => {
  it("returns French for the default locale", () => {
    expect(loadMessages(defaultLocale)).toEqual(fr);
  });

  it("falls back to French for keys missing in another locale", () => {
    expect(loadMessages("en")).toEqual(fr);
    expect(loadMessages("es")).toEqual(fr);
  });
});
