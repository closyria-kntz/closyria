import { describe, expect, it } from "vitest";
import { adminPathOf } from "./proxy";

describe("adminPathOf", () => {
  it("keeps the path and the query asked for", () => {
    expect(adminPathOf(new URL("https://closyria.com/admin/utilisatrices?q=anna&kind=guests"))).toBe(
      "/admin/utilisatrices?q=anna&kind=guests",
    );
    expect(adminPathOf(new URL("https://closyria.com/admin"))).toBe("/admin");
  });

  it("drops Next's `_rsc` parameter of a client-side navigation", () => {
    expect(adminPathOf(new URL("https://closyria.com/admin?x=1&_rsc=abc12"))).toBe("/admin?x=1");
    expect(adminPathOf(new URL("https://closyria.com/admin?_rsc=abc12"))).toBe("/admin");
  });
});
