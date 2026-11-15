import { describe, expect, it } from "vitest";
import { ignoredReason } from "./sender";

type Result = Parameters<typeof ignoredReason>[0];
const result = (signingDomain: string, status: string, h: string) =>
  ({
    dkim: { results: [{ signingDomain, status: { result: status }, signingHeaders: { keys: h } }], headerFrom: [] },
  }) as unknown as Result;

describe("ignoredReason", () => {
  it("never names an address", () => {
    const rcpt = "commande-ab12@commandes.dev.closyria.com";
    const fields = [{ name: "to", value: rcpt }];
    const reason = ignoredReason(result("hotmail.com", "fail", "from:to:subject"), fields, "marie.k@hotmail.com", rcpt);
    expect(reason).not.toContain("marie");
    expect(reason).not.toContain("commande-ab12");
    expect(reason).toContain("domain hotmail.com");
    expect(reason).toContain("d=hotmail.com fail");
    expect(ignoredReason(result("x.com", "pass", "from"), fields, undefined, rcpt)).toBe(
      "From is not one of her verified addresses",
    );
  });
});
