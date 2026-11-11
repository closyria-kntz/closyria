import { describe, expect, it } from "vitest";
import { lineOf } from "./item-line";

describe("lineOf", () => {
  it("places each stage on the line « Envie · Commandé · Reçu · Dans mon dressing »", () => {
    expect(lineOf({ stage: "spotted", received: false })).toEqual({ current: "envie", status: null });
    expect(lineOf({ stage: "ordered", received: false })).toEqual({ current: "commande", status: null });
    expect(lineOf({ stage: "owned", received: true })).toEqual({ current: "recu", status: null });
    expect(lineOf({ stage: "owned", received: false })).toEqual({ current: "dressing", status: null });
  });

  it("keeps « Dans mon dressing » with a chip on sale, sold or returned", () => {
    expect(lineOf({ stage: "for_sale", received: false })).toEqual({ current: "dressing", status: "for_sale" });
    expect(lineOf({ stage: "sold", received: false })).toEqual({ current: "dressing", status: "sold" });
    expect(lineOf({ stage: "returned", received: true })).toEqual({ current: "dressing", status: "returned" });
  });
});
