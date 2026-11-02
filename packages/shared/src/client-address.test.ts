import { describe, expect, it } from "vitest";
import { lastForwardedAddress } from "./client-address";

describe("lastForwardedAddress", () => {
  it("takes the last entry, the one Caddy wrote", () => {
    expect(lastForwardedAddress("203.0.113.9")).toBe("203.0.113.9");
    expect(lastForwardedAddress("spoofed, 203.0.113.9")).toBe("203.0.113.9");
    expect(lastForwardedAddress("203.0.113.9, ")).toBe("203.0.113.9");
    expect(lastForwardedAddress(" 2001:db8::1 ")).toBe("2001:db8::1");
  });

  it("gives undefined without a usable entry", () => {
    for (const header of [undefined, null, "", " , "]) expect(lastForwardedAddress(header)).toBeUndefined();
  });
});
