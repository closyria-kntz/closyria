import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extract, isShopifyPage, parsePriceCents, shopifyJsUrl } from "./index";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url), "utf8");
const run = (name: string, url = "https://shop.example.com/p/x", contentType = "text/html") =>
  extract({ url, contentType, body: fixture(name) });

describe("extract jsonld", () => {
  it("reads a simple Product", () => {
    const r = run("jsonld-simple.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.method).toBe("jsonld");
    expect(r.product).toMatchObject({
      name: "Robe d'été",
      brand: "Maison",
      description: "Jolie robe",
      priceCents: 2999,
      currency: "EUR",
      externalId: "R-1",
      platform: "other",
    });
    expect(r.product.images).toEqual(["https://cdn.example.com/a.jpg", "https://shop.example.com/b.jpg"]);
    expect(r.product.description).not.toContain("alert");
  });
  it("reads a ProductGroup in @graph with variants", () => {
    const r = run("jsonld-group.html");
    if (!r.ok) throw new Error("not ok");
    expect(r.product.sizes).toEqual([
      { label: "S", available: true, priceCents: 4900 },
      { label: "M", available: false, priceCents: 4900 },
      { label: "L", available: true, priceCents: 5200 },
    ]);
    expect(r.product.priceCents).toBe(4900);
    expect(r.product.brand).toBe("Laine");
  });
  it("skips broken JSON-LD and reads sizes from offers", () => {
    const r = run("jsonld-broken-then-valid.html");
    if (!r.ok) throw new Error("not ok");
    expect(r.product.name).toBe("Veste");
    expect(r.product.currency).toBe("USD");
    expect(r.product.priceCents).toBe(8990);
    expect(r.product.sizes.map((s) => [s.label, s.available])).toEqual([
      ["38", true],
      ["40", false],
    ]);
  });
  it("handles AggregateOffer, top-level arrays and missing currency", () => {
    const body = `<script type="application/ld+json">[{"@type":["Thing","Product"],"name":"A","offers":{"@type":"AggregateOffer","lowPrice":"10","highPrice":"20"}}]</script>`;
    const r = extract({ url: "https://a.com/x", contentType: "text/html", body });
    if (!r.ok) throw new Error("not ok");
    expect(r.product.priceCents).toBe(1000);
    expect(r.product.currency).toBe("EUR");
    expect(r.product.sizes).toEqual([]);
  });
  it("falls back to opengraph when JSON-LD has no price", () => {
    const body = `<script type="application/ld+json">{"@type":"Product","name":"A"}</script><meta property="og:title" content="A"><meta property="og:price:amount" content="5"><meta property="og:price:currency" content="eur">`;
    const r = extract({ url: "https://a.com/x", contentType: "text/html", body });
    if (!r.ok) throw new Error("not ok");
    expect(r.method).toBe("opengraph");
    expect(r.product.currency).toBe("EUR");
    expect(r.product.priceCents).toBe(500);
  });
});

describe("extract opengraph", () => {
  it("reads Open Graph with price", () => {
    const r = run("opengraph-product.html");
    if (!r.ok) throw new Error("not ok");
    expect(r.method).toBe("opengraph");
    expect(r.product).toMatchObject({
      name: "Sac & pochette",
      priceCents: 129900,
      currency: "CHF",
      siteName: "Boutique",
      description: "Un sac",
    });
    expect(r.product.images).toEqual(["https://img.example.com/1.jpg", "https://img.example.com/2.jpg"]);
  });
  it("returns not_a_product for a home page", () => {
    expect(run("opengraph-home.html")).toEqual({ ok: false, error: "not_a_product" });
  });
  it("returns not_a_product for non-HTML or empty pages", () => {
    expect(extract({ url: "https://a.com", contentType: "application/pdf", body: "x" })).toEqual({
      ok: false,
      error: "not_a_product",
    });
    expect(extract({ url: "https://a.com", contentType: "text/html", body: "" })).toEqual({
      ok: false,
      error: "not_a_product",
    });
  });
});

describe("cleaning limits", () => {
  it("truncates a 400-char name to 300", () => {
    const body = `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "n".repeat(400), offers: { price: 1 } })}</script>`;
    const r = extract({ url: "https://a.com/x", contentType: "text/html", body });
    if (!r.ok) throw new Error("not ok");
    expect(r.product.name).toHaveLength(300);
  });
  it("keeps 8 photos at most", () => {
    const image = Array.from({ length: 12 }, (_, i) => `https://a.com/${i}.jpg`);
    const body = `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "n", image, offers: { price: 1 } })}</script>`;
    const r = extract({ url: "https://a.com/x", contentType: "text/html", body });
    if (!r.ok) throw new Error("not ok");
    expect(r.product.images).toHaveLength(8);
  });
  it("strips script tags from description, handles image objects and long sizes", () => {
    const body = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "n",
      description: "a<script>evil()</script>b &lt;i&gt; &#65; &#x42; &nbsp;c",
      image: { url: "https://a.com/i.jpg" },
      offers: { price: 1, priceCurrency: "EUR", availability: "InStock" },
      hasVariant: [{ size: "x".repeat(60) }, { size: "" }, {}],
    }).replaceAll("</script>", "\\u003c/script>")}</script>`;
    const r = extract({ url: "https://a.com/x", contentType: "text/html", body });
    if (!r.ok) throw new Error("not ok");
    expect(r.product.description).toBe("a b A B c");
    expect(r.product.images).toEqual(["https://a.com/i.jpg"]);
    expect(r.product.sizes).toHaveLength(1);
    expect(r.product.sizes[0]?.label).toHaveLength(40);
  });
  it("returns invalid_data when the validated result is refused", () => {
    const body = `<script type="application/ld+json">{"@type":"Product","name":"n","offers":{"price":1,"priceCurrency":"EURO"}}</script>`;
    expect(extract({ url: "https://a.com/x", contentType: "text/html", body })).toEqual({
      ok: false,
      error: "invalid_data",
    });
  });
});

describe("parsePriceCents", () => {
  it.each([
    ["1.299,00 €", 129900],
    ["29.99", 2999],
    [29.99, 2999],
    ["29,99 €", 2999],
    ["1,299.00", 129900],
    ["1 299,00", 129900],
    ["30", 3000],
    ["1.299", 129900],
    ["gratuit", null],
    ["", null],
    [-5, null],
    [Number.NaN, null],
  ])("%s -> %s", (input, expected) => {
    expect(parsePriceCents(input)).toBe(expected);
  });
});

describe("shopify helpers", () => {
  it("detects Shopify markers", () => {
    expect(isShopifyPage("<script>Shopify.shop = 'a.myshopify.com'</script>")).toBe(true);
    expect(isShopifyPage('<img src="https://cdn.shopify.com/x.png">')).toBe(true);
    expect(isShopifyPage("<html></html>")).toBe(false);
  });
  it("builds the .js url whatever the prefix", () => {
    expect(shopifyJsUrl("https://s.com/products/robe-bleue")).toBe("https://s.com/products/robe-bleue.js");
    expect(shopifyJsUrl("https://s.com/collections/x/products/h?variant=1#a")).toBe(
      "https://s.com/collections/x/products/h.js",
    );
    expect(shopifyJsUrl("https://s.com/fr/products/h/")).toBe("https://s.com/fr/products/h.js");
    expect(shopifyJsUrl("https://s.com/pages/about")).toBeNull();
    expect(shopifyJsUrl("not a url")).toBeNull();
  });
});

describe("edge cases", () => {
  const og = (metas: string) => extract({ url: "https://a.com/p", contentType: "text/html", body: metas });
  it("reads Open Graph with reversed/unquoted-safe attributes, no currency and bad entities", () => {
    const r = og(
      `<meta name="og:title" content="T &#x110000; &unknown;"><meta property="og:price:amount" content="12"><meta property="og:image:url" content="x://bad"><meta content="no-key"><meta property="og:image" content="http://a.com/1.jpg">`,
    );
    if (!r.ok) throw new Error("not ok");
    expect(r.product.currency).toBe("EUR");
    expect(r.product.name).toBe("T &unknown;");
    expect(r.product.images).toEqual(["http://a.com/1.jpg"]);
  });
  it("rejects Open Graph with an unparsable price", () => {
    expect(
      og(`<meta property="og:title" content="T"><meta property="product:price:amount" content="gratuit">`),
    ).toEqual({
      ok: false,
      error: "not_a_product",
    });
  });
  it("ignores JSON-LD nodes that are not products or have no usable offers", () => {
    const body = `<script type="application/ld+json">[1,"x",{"@type":"Organization"},{"@type":"Product","name":"B","offers":["x",{"price":"abc"}]},{"@type":"Product","name":"C","offers":{"priceSpecification":{"price":"7"},"offers":[{"price":8,"priceCurrency":"gbp"}]},"brand":3}]</script>`;
    const r = og(body);
    if (!r.ok) throw new Error("not ok");
    expect(r.product.name).toBe("C");
    expect(r.product.priceCents).toBe(700);
    expect(r.product.currency).toBe("GBP");
  });
  it("reads sizes from top-level offers with object sizes and prices, skipping duplicates", () => {
    const body = `<script type="application/ld+json">{"@type":"Product","name":"D","productID":12,"offers":[{"price":5,"size":{"name":"M"},"availability":"InStock"},{"price":6,"size":"M"},{"price":6,"size":7}]}</script>`;
    const r = og(body);
    if (!r.ok) throw new Error("not ok");
    expect(r.product.externalId).toBe("12");
    expect(r.product.sizes.map((s) => s.label)).toEqual(["M", "7"]);
  });
  it("rejects absurd image values and invalid URLs", () => {
    const body = `<script type="application/ld+json">{"@type":"Product","name":"E","image":[1,"","http://[bad",{"contentUrl":"https://a.com/z.png"}],"offers":{"price":1}}</script>`;
    const r = og(body);
    if (!r.ok) throw new Error("not ok");
    expect(r.product.images).toEqual(["https://a.com/z.png"]);
  });
  it("rejects invalid code points and numeric price edge cases", () => {
    expect(parsePriceCents("12,")).toBe(1200);
    expect(parsePriceCents("1.2.3")).toBe(12300);
    expect(parsePriceCents("1e999999")).toBe(100);
  });
});

describe("decoding and machine prices", () => {
  const ld = (o: object) =>
    extract({
      url: "https://a.com/p",
      contentType: "text/html",
      body: `<script type="application/ld+json">${JSON.stringify(o).replaceAll("</", "<\\/")}</script>`,
    });
  const og = (title: string, extra = "") =>
    extract({
      url: "https://a.com/p",
      contentType: "text/html",
      body: `<meta property="og:title" content="T"><meta property="og:description" content="${title}"><meta property="og:image" content="https://a.com/i.jpg?a=1&amp;b=2">${extra}<meta property="product:price:amount" content="5">`,
    });
  it("decodes before stripping, on JSON-LD and Open Graph", () => {
    const text = "&lt;p&gt;Hello&lt;/p&gt; <b>x</b>";
    const a = ld({ "@type": "Product", name: "n", description: text, offers: { price: 1 } });
    const b = og(text);
    if (!a.ok || !b.ok) throw new Error("not ok");
    expect(a.product.description).toBe("Hello x");
    expect(b.product.description).toBe("Hello x");
    expect(b.product.images).toEqual(["https://a.com/i.jpg?a=1&b=2"]);
  });
  it("decodes exactly once", () => {
    const a = ld({ "@type": "Product", name: "n", description: "A &amp;amp; B", offers: { price: 1 } });
    const b = og("A &amp;amp; B");
    if (!a.ok || !b.ok) throw new Error("not ok");
    expect(a.product.description).toBe("A &amp; B");
    expect(b.product.description).toBe("A &amp; B");
  });
  it.each([
    ["29.999", 3000],
    ["1299", 129900],
    ["1299.00", 129900],
    ["89,90", 8990],
    [12.5, 1250],
    ["-5,00", null],
    [-5, null],
    ["€-5,00", null],
    ["€-5", null],
    ["\u22125", null],
    ["29.999 EUR", 3000],
    ["€ 1299.00", 129900],
  ])("machine price %s -> %s", (price, cents) => {
    const a = ld({ "@type": "Product", name: "n", offers: { price } });
    const b = extract({
      url: "https://a.com/p",
      contentType: "text/html",
      body: `<meta property="og:title" content="T"><meta property="product:price:amount" content="${price}">`,
    });
    for (const r of [a, b]) {
      if (cents === null) expect(r).toEqual({ ok: false, error: "not_a_product" });
      else expect(r.ok && r.product.priceCents).toBe(cents);
    }
  });
  it.each(["-5,00", "€-5,00", "€-5", "\u22125"])("parsePriceCents %s is null", (v) => {
    expect(parsePriceCents(v)).toBeNull();
  });
  it("keeps real < and > in text, strips only tag-like markup", () => {
    const a = ld({
      "@type": "Product",
      name: "n",
      description: "Longueur &lt;40 cm et largeur &gt;20 cm",
      offers: { price: 1 },
    });
    if (!a.ok) throw new Error("not ok");
    expect(a.product.description).toBe("Longueur <40 cm et largeur >20 cm");
  });
});
