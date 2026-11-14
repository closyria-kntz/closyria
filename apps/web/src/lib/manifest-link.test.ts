import { describe, expect, it } from "vitest";
import { linksManifest } from "./manifest-link";

describe("linksManifest", () => {
  it("links the manifest everywhere but on the dev access page", () => {
    for (const path of ["/", "/articles", "/connexion", "/admin", "/l/abc"])
      expect(linksManifest(path), path).toBe(true);
    expect(linksManifest("/acces-dev")).toBe(false);
  });
});
