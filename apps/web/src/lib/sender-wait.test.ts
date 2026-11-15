import { describe, expect, it } from "vitest";
import { senderWait } from "./sender-wait";

describe("senderWait (« Réessaie dans … »)", () => {
  it("rounds up, in minutes under an hour, then in hours", () => {
    expect(senderWait(1)).toEqual({ key: "minute" });
    expect(senderWait(60)).toEqual({ key: "minute" });
    expect(senderWait(61)).toEqual({ key: "minutes", n: 2 });
    expect(senderWait(59 * 60)).toEqual({ key: "minutes", n: 59 });
    expect(senderWait(59 * 60 + 1)).toEqual({ key: "hour" });
    expect(senderWait(3600)).toEqual({ key: "hour" });
    expect(senderWait(3601)).toEqual({ key: "hours", n: 2 });
    expect(senderWait(24 * 3600 - 60)).toEqual({ key: "hours", n: 24 });
  });
});
