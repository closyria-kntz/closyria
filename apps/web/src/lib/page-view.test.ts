import { describe, expect, it } from "vitest";
import { tracksPageViews } from "./page-view";

describe("tracksPageViews", () => {
  it("counts the public pages but never the admin area", () => {
    expect(tracksPageViews("/")).toBe(true);
    expect(tracksPageViews("/connexion")).toBe(true);
    expect(tracksPageViews("/administration-du-dressing")).toBe(true);
    for (const path of ["/admin", "/admin/", "/admin/audit", "/admin/passkey-required"]) {
      expect(tracksPageViews(path), path).toBe(false);
    }
  });
});

describe("tracksPageViews on the dev access page", () => {
  it("never counts /acces-dev: before access, Caddy refuses /api/events there anyway", () => {
    expect(tracksPageViews("/acces-dev")).toBe(false);
    expect(tracksPageViews("/acces-dev-bis")).toBe(true);
  });
});
