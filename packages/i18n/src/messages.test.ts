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

// Visual spec §9: the interface says "tu". Imperatives ending in -ez (réessayez, cliquez…) betray "vous".
const VOUVOIEMENT = /\b(vous|votre|vos)\b|-vous\b|\p{L}+ez\b/iu;
const NOT_VOUVOIEMENT = new Set(["chez", "assez", "nez"]);

function vouvoie(message: string): boolean {
  const words = message.match(new RegExp(VOUVOIEMENT.source, "giu")) ?? [];
  return words.some((word) => !NOT_VOUVOIEMENT.has(word.toLowerCase()));
}

describe("French tone", () => {
  it("detects vouvoiement", () => {
    expect(vouvoie("Votre code")).toBe(true);
    expect(vouvoie("Connectez-vous")).toBe(true);
    expect(vouvoie("réessayez")).toBe(true);
    expect(vouvoie("Ton code, chez toi, réessaie")).toBe(false);
  });

  it("uses tutoiement in every French message", () => {
    const offending = Object.entries(flatten(fr)).filter(([, message]) => vouvoie(message));
    expect(offending).toEqual([]);
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
