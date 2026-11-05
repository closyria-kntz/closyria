import { describe, expect, it } from "vitest";
import { extractSharedUrl } from "./shared-url";

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
