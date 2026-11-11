import { describe, expect, it } from "vitest";
import { extractSharedUrl, sharedUrlFromQuery } from "./shared-url";

describe("extractSharedUrl", () => {
  it("takes the url parameter when it is an http(s) address", () => {
    expect(extractSharedUrl({ url: "https://zara.com/fr/x.html", text: "https://other.com" })).toBe(
      "https://zara.com/fr/x.html",
    );
  });

  it("finds the link inside a shared text (Android)", () => {
    expect(extractSharedUrl({ text: "Regarde ça https://zara.com/fr/x.html !" })).toBe("https://zara.com/fr/x.html");
  });

  it("falls back to the title, after the text", () => {
    expect(extractSharedUrl({ title: "Robe http://a.fr/p" })).toBe("http://a.fr/p");
    expect(extractSharedUrl({ text: "https://b.fr/t", title: "https://a.fr/p" })).toBe("https://b.fr/t");
  });

  it("ignores a url parameter that is not http(s)", () => {
    expect(extractSharedUrl({ url: "javascript:alert(1)", text: "voir https://b.fr/t" })).toBe("https://b.fr/t");
    expect(extractSharedUrl({ url: "ftp://x.fr/a" })).toBeNull();
  });

  it("returns null when there is no link", () => {
    expect(extractSharedUrl({ text: "rien" })).toBeNull();
    expect(extractSharedUrl({})).toBeNull();
  });

  it("drops trailing punctuation glued to the link", () => {
    expect(extractSharedUrl({ text: "Regarde (https://zara.com/x), super" })).toBe("https://zara.com/x");
  });
});

describe("sharedUrlFromQuery", () => {
  it("takes everything after url= when the link is not encoded, its own ? and & included", () => {
    expect(sharedUrlFromQuery("?url=https://zara.com/fr/robe.html?v1=45&v2=78")).toBe(
      "https://zara.com/fr/robe.html?v1=45&v2=78",
    );
    expect(sharedUrlFromQuery("?title=Robe&url=http://a.fr/p?x=1&y=%202")).toBe("http://a.fr/p?x=1&y=%202");
  });

  it("keeps the unencoded link's fragment, which the browser puts apart in location.hash", () => {
    expect(sharedUrlFromQuery("?url=https://a.fr/p?x=1", "#v=2")).toBe("https://a.fr/p?x=1#v=2");
    // An encoded link carries its own fragment (%23): the page's hash is not added to it.
    expect(sharedUrlFromQuery(`?url=${encodeURIComponent("https://a.fr/p#v=2")}`, "#other")).toBe("https://a.fr/p#v=2");
  });

  it("decodes an encoded link (the share target, a shortcut that encodes)", () => {
    expect(sharedUrlFromQuery(`?url=${encodeURIComponent("https://zara.com/x?a=1&b=2")}`)).toBe(
      "https://zara.com/x?a=1&b=2",
    );
    expect(sharedUrlFromQuery(`?url=${encodeURIComponent("https://b.fr/t")}&title=Robe`)).toBe("https://b.fr/t");
  });

  it("does not take a url= inside another parameter's name", () => {
    expect(sharedUrlFromQuery("?myurl=https://a.fr/p")).toBeNull();
  });

  it("returns null without an http(s) link after url=", () => {
    expect(sharedUrlFromQuery("?title=a&text=b&url=")).toBeNull();
    expect(sharedUrlFromQuery("?url=javascript:alert(1)")).toBeNull();
    expect(sharedUrlFromQuery("")).toBeNull();
    expect(sharedUrlFromQuery("?url=%E0%A4%A")).toBeNull();
  });
});
