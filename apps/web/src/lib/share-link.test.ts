import { describe, expect, it } from "vitest";
import { absoluteShareUrl } from "./share-link";

describe("absoluteShareUrl", () => {
  it("makes the link from the path the API returned", () => {
    expect(absoluteShareUrl("https://closyria.com", "/l/abc_DEF-123")).toBe("https://closyria.com/l/abc_DEF-123");
  });

  it("does not double the slash of an origin", () => {
    expect(absoluteShareUrl("https://closyria.com/", "/l/abc")).toBe("https://closyria.com/l/abc");
  });
});
