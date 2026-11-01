import { describe, expect, it } from "vitest";
import { routeTemplate, UNKNOWN_ROUTE } from "./route-template";

describe("routeTemplate", () => {
  it("keeps static routes", () => {
    expect(routeTemplate("/", {})).toBe("/");
    expect(routeTemplate("/signup", null)).toBe("/signup");
  });
  it("replaces dynamic segments by their name", () => {
    expect(routeTemplate("/items/42", { id: "42" })).toBe("/items/[id]");
    expect(routeTemplate("/u/jean%40x.fr/items/7", { who: "jean%40x.fr", id: "7" })).toBe("/u/[who]/items/[id]");
    expect(routeTemplate("/u/jean%40x.fr/items/7", { who: "jean@x.fr", id: "7" })).toBe("/u/[who]/items/[id]");
  });
  it("replaces catch-all segments", () => {
    expect(routeTemplate("/a/b/c", { slug: ["b", "c"] })).toBe("/a/[...slug]");
  });
  it("matches from the right: a value equal to an earlier static segment", () => {
    expect(routeTemplate("/u/u", { handle: "u" })).toBe("/u/[handle]");
    expect(routeTemplate("/items/items/items", { id: "items" })).toBe("/items/items/[id]");
  });
  it("ignores empty params (optional catch-all with nothing)", () => {
    expect(routeTemplate("/docs", { slug: [] })).toBe("/docs");
    expect(routeTemplate("/docs", { slug: undefined })).toBe("/docs");
  });
  it("never throws on malformed percent sequences and never leaks the raw path", () => {
    for (const value of ["100%", "%E0%A4%A", "%"]) {
      const result = routeTemplate(`/items/${value}`, { id: value });
      expect(result).toBe("/items/[id]");
    }
    // A value that cannot be found in the path: placeholder, not the pathname.
    expect(routeTemplate("/items/secret%", { id: "other" })).toBe(UNKNOWN_ROUTE);
    expect(routeTemplate("/items/jean%40x.fr", { id: "%E0%A4%A" })).toBe(UNKNOWN_ROUTE);
  });
  it("accepts a value that useParams already decoded", () => {
    expect(routeTemplate("/items/100%25", { id: "100%" })).toBe("/items/[id]");
  });
});
