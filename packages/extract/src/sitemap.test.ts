import { describe, expect, it } from "vitest";
import { extractSitemap } from "./sitemap";

const INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://boutique.example/sitemap_products_1.xml?from=1&amp;to=99</loc>
  </sitemap>
  <sitemap><loc>https://boutique.example/sitemap_pages_1.xml</loc></sitemap>
  <sitemap><loc> https://boutique.example/sitemap_products_2.xml </loc></sitemap>
</sitemapindex>`;

const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>https://boutique.example/</loc><changefreq>daily</changefreq></url>
  <url>
    <loc>https://boutique.example/products/robe</loc>
    <image:image><image:loc>https://cdn.example/robe.jpg</image:loc></image:image>
  </url>
  <url><loc><![CDATA[https://boutique.example/products/jupe]]></loc></url>
</urlset>`;

describe("extractSitemap", () => {
  it("reads the sitemaps of an index, entities decoded", () => {
    expect(extractSitemap(INDEX)).toEqual({
      kind: "index",
      locs: [
        "https://boutique.example/sitemap_products_1.xml?from=1&to=99",
        "https://boutique.example/sitemap_pages_1.xml",
        "https://boutique.example/sitemap_products_2.xml",
      ],
    });
  });

  it("reads the page addresses of a urlset, not its image addresses", () => {
    expect(extractSitemap(URLSET)).toEqual({
      kind: "urlset",
      locs: [
        "https://boutique.example/",
        "https://boutique.example/products/robe",
        "https://boutique.example/products/jupe",
      ],
    });
  });

  it("skips an entry whose address is not an http(s) URL", () => {
    const xml = `<urlset><url><loc>javascript:alert(1)</loc></url><url><loc>https://a.example/products/x</loc></url></urlset>`;
    expect(extractSitemap(xml)).toEqual({ kind: "urlset", locs: ["https://a.example/products/x"] });
  });

  it("is null for anything that is not a sitemap", () => {
    expect(extractSitemap("<html><body>Not found</body></html>")).toBeNull();
    expect(extractSitemap('{"products":[]}')).toBeNull();
    expect(extractSitemap("")).toBeNull();
  });
});
