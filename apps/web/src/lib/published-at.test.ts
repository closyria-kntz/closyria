import { describe, expect, it } from "vitest";
import { publishedAtSave, publishedDay } from "./published-at";

const shop = { publishedAt: "2026-10-01T10:00:00.000Z", publishedSource: "shop" } as const;
const unknown = { publishedAt: null, publishedSource: "unknown" } as const;
const admin = { publishedAt: "2026-11-02T00:00:00.000Z", publishedSource: "admin" } as const;
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const afterTomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

describe("« Date de mise en ligne » de la fiche admin", () => {
  it("montre le jour UTC de la date, vide quand elle est inconnue", () => {
    expect(publishedDay(shop)).toBe("2026-10-01");
    expect(publishedDay(admin)).toBe("2026-11-02");
    expect(publishedDay(unknown)).toBe("");
  });

  it("n'envoie rien pour une date affichée inchangée : une date automatique ne devient pas « saisie dans l'admin »", () => {
    expect(publishedAtSave("2026-10-01", shop)).toEqual({ kind: "unchanged" });
    expect(publishedAtSave("", unknown)).toEqual({ kind: "unchanged" });
    expect(publishedAtSave("2026-11-02", admin)).toEqual({ kind: "unchanged" });
  });

  it("vider le champ ne revient à la date automatique que pour une date saisie dans l'admin", () => {
    expect(publishedAtSave("", admin)).toEqual({ kind: "send", body: { publishedAt: null } });
    expect(publishedAtSave("", shop)).toEqual({ kind: "invalid" });
  });

  it("envoie un autre jour valide, jusqu'à demain, et refuse le reste comme l'API", () => {
    expect(publishedAtSave("2026-09-30", shop)).toEqual({ kind: "send", body: { publishedAt: "2026-09-30" } });
    expect(publishedAtSave(tomorrow, unknown)).toEqual({ kind: "send", body: { publishedAt: tomorrow } });
    for (const day of [afterTomorrow, "1999-12-31", "2026-13-01"]) {
      expect(publishedAtSave(day, unknown), day).toEqual({ kind: "invalid" });
    }
  });
});
