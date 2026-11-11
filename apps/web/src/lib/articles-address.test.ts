import { describe, expect, it } from "vitest";
import { articlesHref, articlesView, oldViewRedirect, STEPS, viewStep } from "./articles-address";

const LIST = "0b9f0e64-1c7c-4c4f-9d1e-3d5c2a1b0f00";
const params = (text: string) => new URLSearchParams(text);

describe("articles address", () => {
  it("shows the view of the step, « Tout » without one (or with an unknown one)", () => {
    expect(articlesView(params(""))).toBe("tout");
    expect(articlesView(params("etape=envie"))).toBe("envies");
    expect(articlesView(params("etape=commande"))).toBe("commande");
    expect(articlesView(params("etape=recu"))).toBe("recu");
    expect(articlesView(params("etape=dressing"))).toBe("dressing");
    expect(articlesView(params("etape=a-vendre"))).toBe("a-vendre");
    expect(articlesView(params("etape=envie&preparer=1"))).toBe("envies");
    expect(articlesView(params("etape=nimporte"))).toBe("tout");
  });

  it("goes from a step to its view and back", () => {
    expect(STEPS).toEqual(["envie", "commande", "recu", "dressing", "a-vendre"]);
    for (const step of STEPS) expect(viewStep(articlesView(params(`etape=${step}`)))).toBe(step);
    expect(viewStep("tout")).toBeNull();
  });

  it("links a chip to its step, keeping the profile and the filters, never the list, the preview or the status", () => {
    const from = params(`etape=envie&liste=${LIST}&apercu=${LIST}&profil=${LIST}&tri=price_asc&statut=sold`);
    expect(articlesHref(from, "dressing")).toBe(`/articles?etape=dressing&profil=${LIST}&tri=price_asc`);
    expect(articlesHref(from, null)).toBe(`/articles?profil=${LIST}&tri=price_asc`);
    expect(articlesHref(params(""), null)).toBe("/articles");
    expect(articlesHref(params("niveau=4,3"), "envie")).toBe("/articles?etape=envie&niveau=4,3");
  });

  it("redirects the old addresses with their step and every parameter they had", () => {
    expect(oldViewRedirect("envies", {})).toBe("/articles?etape=envie");
    expect(oldViewRedirect("envies", { liste: LIST, prioritaire: "1" })).toBe(
      `/articles?etape=envie&liste=${LIST}&prioritaire=1`,
    );
    expect(oldViewRedirect("dressing", { niveau: "4,3", tri: "price_asc" })).toBe(
      "/articles?etape=dressing&niveau=4,3&tri=price_asc",
    );
    expect(oldViewRedirect("a-vendre", { profil: LIST })).toBe(`/articles?etape=a-vendre&profil=${LIST}`);
    expect(oldViewRedirect("commande", { recherche: "robe d'été" })).toBe(
      "/articles?etape=commande&recherche=robe+d%27%C3%A9t%C3%A9",
    );
    expect(oldViewRedirect("dressing", { etape: "sold" })).toBe("/articles?etape=dressing&statut=sold");
    expect(oldViewRedirect("envies", { etiquette: ["a", "b"] })).toBe("/articles?etape=envie&etiquette=a&etiquette=b");
  });
});
