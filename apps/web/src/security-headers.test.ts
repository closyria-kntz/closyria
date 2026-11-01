import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

const headerMap = () => Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]));
const directive = (name: string) =>
  headerMap()
    ["Content-Security-Policy-Report-Only"]?.split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `));

describe("securityHeaders", () => {
  it("sets the baseline headers", () => {
    expect(headerMap()).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it("ships the full CSP in report-only mode; only frame-ancestors is enforced", () => {
    expect(headerMap()["Content-Security-Policy-Report-Only"]).toBeDefined();
    expect(headerMap()["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
  });

  it("forbids framing, also for browsers without frame-ancestors", () => {
    expect(headerMap()["X-Frame-Options"]).toBe("DENY");
  });

  it("locks down framing, base, forms and plugins", () => {
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("default-src")).toBe("default-src 'self'");
  });

  it("allows only same-origin scripts, connections and fonts, and OVH S3 photos", () => {
    expect(directive("script-src")).toBe("script-src 'self'");
    expect(directive("connect-src")).toBe("connect-src 'self'");
    expect(directive("font-src")).toBe("font-src 'self'");
    // s3Store is path-style (forcePathStyle): photo URLs are https://s3.gra.io.cloud.ovh.net/<bucket>/<key>.
    expect(directive("img-src")).toBe("img-src 'self' data: blob: https://s3.gra.io.cloud.ovh.net");
  });
});

describe("next.config headers()", () => {
  it("applies the security headers to every path", async () => {
    const { default: config } = await import("../next.config");
    const rules = await config.headers?.();
    expect(rules).toEqual([{ source: "/:path*", headers: securityHeaders }]);
  });
});

describe("Caddy HSTS", () => {
  for (const file of ["closyria.com.caddy", "dev.closyria.com.caddy"]) {
    it(`${file} sends HSTS without preload`, () => {
      const text = readFileSync(fileURLToPath(new URL(`../../../deploy/caddy/${file}`, import.meta.url)), "utf8");
      expect(text).toContain('header Strict-Transport-Security "max-age=31536000; includeSubDomains"');
      expect(text).not.toContain("preload");
    });
  }
});
