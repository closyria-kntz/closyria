import { describe, expect, it } from "vitest";
import { extract } from "./index";

const URL_ = "https://shop.test/produit/robe";
const jsonLd = (images: string[]) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "Robe",
    image: images,
    color: "Bleu",
    offers: { price: "49.00", priceCurrency: "EUR" },
  })}</script>`;
const gallery = (images: string[]) =>
  images
    .map(
      (src) =>
        `<div data-thumb="${src}" class="woocommerce-product-gallery__image"><a href="${src}"><img src="${src}?small" data-large_image="${src}" /></a></div>`,
    )
    .join("");
const row = (label: string, value: string) =>
  `<tr class="woocommerce-product-attributes-item"><th class="woocommerce-product-attributes-item__label">${label}</th><td class="woocommerce-product-attributes-item__value"><p>${value}</p></td></tr>`;
const table = (rows: string) => `<table class="woocommerce-product-attributes shop_attributes">${rows}</table>`;

const run = (body: string) => {
  const r = extract({ url: URL_, contentType: "text/html", body: `<html><body>${body}</body></html>` });
  if (!r.ok) throw new Error(r.error);
  return r.product;
};

describe("WooCommerce pages", () => {
  it("takes the gallery photos in order, without duplicates (slider clones)", () => {
    const p = run(jsonLd(["/a.jpg"]) + gallery(["/a.jpg", "/b.jpg", "/c.jpg", "/a.jpg", "/b.jpg"]));
    expect(p.images).toEqual(["a", "b", "c"].map((n) => `https://shop.test/${n}.jpg`));
  });

  it("falls back to the link when the image has no data-large_image", () => {
    const p = run(
      jsonLd(["/a.jpg"]) +
        `<div class="woocommerce-product-gallery__image"><a href="/big.jpg"><img src="/small.jpg" /></a></div>`,
    );
    expect(p.images).toEqual(["https://shop.test/big.jpg"]);
  });

  it("keeps the JSON-LD photos when there is no gallery", () => {
    expect(run(jsonLd(["/a.jpg", "/b.jpg"])).images).toHaveLength(2);
  });

  it("reads the attributes table; the shop's colour does not replace the JSON-LD one", () => {
    const p = run(
      jsonLd(["/a.jpg"]) +
        table(row("Matière", "100 % lin") + row("Couleur", "Rouge") + row("Conseils d&#039;entretien", "30 °C")),
    );
    expect(p.shopData?.details).toEqual([
      { label: "Matière", value: "100 % lin" },
      { label: "Couleur", value: "Rouge" },
      { label: "Conseils d'entretien", value: "30 °C" },
    ]);
    expect(p.shopData?.material).toBe("100 % lin");
    expect(p.shopData?.care).toBe("30 °C");
    expect(p.shopData?.colors).toEqual(["Bleu"]);
  });

  it("caps the table at 20 rows, skips empty ones and keeps labels and values short", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(`L${i}`, `v${i}`)).join("");
    const p = run(
      jsonLd(["/a.jpg"]) + table(row("", "x") + row("Vide", "") + row("L".repeat(150), "y".repeat(900)) + rows),
    );
    const details = p.shopData?.details ?? [];
    expect(details).toHaveLength(20);
    expect(details[0]?.label).toHaveLength(80);
    expect(details[0]?.value).toHaveLength(500);
    expect(details[1]).toEqual({ label: "L0", value: "v0" });
  });

  it("ignores a page without WooCommerce markup", () => {
    expect(run(jsonLd(["/a.jpg"])).shopData?.details).toBeUndefined();
  });
});
