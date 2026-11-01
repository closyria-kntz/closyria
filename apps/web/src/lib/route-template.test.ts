import { describe, expect, it } from "vitest";
import { routeTemplate } from "./route-template";

describe("routeTemplate", () => {
  it("keeps static routes", () => {
    expect(routeTemplate("/", {})).toBe("/");
    expect(routeTemplate("/signup", null)).toBe("/signup");
  });
  it("replaces dynamic segments by their name", () => {
    expect(routeTemplate("/items/42", { id: "42" })).toBe("/items/[id]");
    expect(routeTemplate("/u/jean%40x.fr/items/7", { who: "jean%40x.fr", id: "7" })).toBe("/u/[who]/items/[id]");
  });
  it("replaces catch-all segments", () => {
    expect(routeTemplate("/a/b/c", { slug: ["b", "c"] })).toBe("/a/[...slug]");
  });
});
