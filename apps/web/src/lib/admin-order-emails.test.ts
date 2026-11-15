import { describe, expect, it } from "vitest";
import { capInputOf, parseEuroCap } from "./admin-order-emails";

describe("parseEuroCap (plafond IA en euros)", () => {
  it("reads euros with a comma or a dot, in cents", () => {
    expect(parseEuroCap("10")).toBe(1000);
    expect(parseEuroCap(" 12,5 ")).toBe(1250);
    expect(parseEuroCap("0.99")).toBe(99);
    expect(parseEuroCap("0")).toBe(0);
    expect(parseEuroCap("1000")).toBe(100_000);
  });

  it("refuses more than 1 000 €, more than 2 decimals, a negative or no number", () => {
    for (const bad of ["1000,01", "1,234", "-1", "", "dix", "1e3", "10 €"]) expect(parseEuroCap(bad), bad).toBeNull();
  });
});

describe("capInputOf", () => {
  it("writes cents back as the field shows them", () => {
    expect(capInputOf(1000)).toBe("10");
    expect(capInputOf(1250)).toBe("12,50");
    expect(capInputOf(5)).toBe("0,05");
  });
});
