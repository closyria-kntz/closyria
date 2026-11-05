import { describe, expect, it } from "vitest";
import { canonicalizeUrl, domainCandidates, nameFromUrl, shopDomain } from "./catalog-url";

describe("canonicalizeUrl", () => {
  it("lowercases the host, drops tracking parameters and the fragment", () => {
    expect(canonicalizeUrl("https://WWW.Shop.fr/products/a?utm_source=x&variant=2#top")).toBe(
      "https://www.shop.fr/products/a?variant=2",
    );
  });
  it("drops every tracking parameter of the list", () => {
    expect(canonicalizeUrl("https://x.fr/a?fbclid=1&gclid=2&mc_cid=3&mc_eid=4&_ga=5&ref=6&utm_medium=7")).toBe(
      "https://x.fr/a",
    );
  });
  it("refuses a non-http(s) address", () => {
    expect(canonicalizeUrl("ftp://x")).toBeNull();
  });
  it("refuses credentials", () => {
    expect(canonicalizeUrl("https://u:p@x.fr/")).toBeNull();
  });
  it("refuses an address longer than 2048 characters", () => {
    expect(canonicalizeUrl(`https://x.fr/${"a".repeat(2049 - 13)}`)).toBeNull();
    expect(canonicalizeUrl(`https://x.fr/${"a".repeat(2048 - 13)}`)).not.toBeNull();
  });
  it("refuses garbage", () => {
    expect(canonicalizeUrl("pas une adresse")).toBeNull();
  });
  it("gives the same result whatever the parameter order", () => {
    expect(canonicalizeUrl("https://x.fr/a?b=1&a=2")).toBe(canonicalizeUrl("https://x.fr/a?a=2&b=1"));
  });
  it("keeps ?variant= distinct", () => {
    expect(canonicalizeUrl("https://x.fr/a?variant=1")).not.toBe(canonicalizeUrl("https://x.fr/a?variant=2"));
  });
  it("removes the default port and the trailing slash, except for the root", () => {
    expect(canonicalizeUrl("https://x.fr:443/a/")).toBe("https://x.fr/a");
    expect(canonicalizeUrl("http://x.fr:80/")).toBe("http://x.fr/");
    expect(canonicalizeUrl("https://x.fr:8443/a")).toBe("https://x.fr:8443/a");
  });
  it("gives one result for the same item with different tracking", () => {
    expect(canonicalizeUrl("https://x.fr/a?utm_source=1#y")).toBe(canonicalizeUrl("https://x.fr/a?ref=z"));
  });
});

describe("shopDomain", () => {
  it("drops www.", () => {
    expect(shopDomain("https://www.zara.com/fr/a")).toBe("zara.com");
    expect(shopDomain("https://shop.mango.com/a")).toBe("shop.mango.com");
  });
});

describe("domainCandidates", () => {
  it("lists the host then its parents down to two labels", () => {
    expect(domainCandidates("shop.mango.com")).toEqual(["shop.mango.com", "mango.com"]);
    expect(domainCandidates("www2.hm.com")).toEqual(["www2.hm.com", "hm.com"]);
    expect(domainCandidates("www.zara.com")).toEqual(["zara.com"]);
    expect(domainCandidates("a.b.c.fr")).toEqual(["a.b.c.fr", "b.c.fr", "c.fr"]);
  });
});

describe("domainCandidates with IP hosts", () => {
  it("returns only the host", () => {
    expect(domainCandidates("127.0.0.1")).toEqual(["127.0.0.1"]);
    expect(domainCandidates("1.2.3.4")).toEqual(["1.2.3.4"]);
    expect(domainCandidates("[::1]")).toEqual(["[::1]"]);
  });
});

describe("nameFromUrl", () => {
  it("uses the last path segment", () => {
    expect(nameFromUrl("https://x.fr/products/robe-camelia-rose")).toBe("Robe camelia rose");
  });
  it("drops the extension and the trailing id", () => {
    expect(nameFromUrl("https://x.fr/fr/robe-x-p12345678.html")).toBe("Robe x");
    expect(nameFromUrl("https://x.fr/fr/robe-x-12345")).toBe("Robe x");
  });
  it("returns null without a usable segment", () => {
    expect(nameFromUrl("https://x.fr/")).toBeNull();
  });
});
