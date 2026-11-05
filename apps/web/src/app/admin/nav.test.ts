import { describe, expect, it } from "vitest";
import { adminNav, isActive } from "./nav";

const entry = (key: string) => adminNav.find((item) => item.key === key);
const dashboard = adminNav[0];
const audit = adminNav.find((item) => item.key === "audit") ?? dashboard;

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

  it("lists the shop and capture screens", () => {
    expect(entry("shops")?.href).toBe("/admin/boutiques");
    expect(entry("captures")?.href).toBe("/admin/captures");
  });

  it("keeps the shops entry active on a shop page", () => {
    const shops = entry("shops");
    expect(shops && isActive(shops, "/admin/boutiques/abc")).toBe(true);
    expect(shops && isActive(shops, "/admin/captures")).toBe(false);
  });
});
