import { describe, expect, it } from "vitest";
import { adminNav, isActive } from "./nav";

const [dashboard, audit] = adminNav;

describe("isActive", () => {
  it("matches the dashboard on /admin only", () => {
    expect(isActive(dashboard, "/admin")).toBe(true);
    expect(isActive(dashboard, "/admin/audit")).toBe(false);
  });

  it("matches a section and its sub-pages, not a lookalike", () => {
    expect(isActive(audit, "/admin/audit")).toBe(true);
    expect(isActive(audit, "/admin/audit/123")).toBe(true);
    expect(isActive(audit, "/admin/auditing")).toBe(false);
  });
});
