import type { schema } from "@closyria/db";
import { describe, expect, it } from "vitest";
import { giftReminderDue, parisDay } from "./wishlists";

const row = (over: Partial<typeof schema.wishlists.$inferSelect> = {}) =>
  ({
    allowGifts: true,
    giftDate: "2027-03-12",
    giftReminderDismissedAt: null,
    giftReminderSnoozedUntil: null,
    ...over,
  }) as typeof schema.wishlists.$inferSelect;

describe("giftReminderDue", () => {
  it("counts days in Paris, not in UTC", () => {
    // 23:30 UTC on the 12th is 00:30 on the 13th in Paris (UTC+1 in March, before the change to summer time).
    expect(parisDay(new Date("2027-03-12T23:30:00Z"))).toBe("2027-03-13");
    expect(giftReminderDue(row(), new Date("2027-03-12T23:30:00Z"))).toBe(true);
    expect(giftReminderDue(row(), new Date("2027-03-12T22:30:00Z"))).toBe(false);
  });

  it("stays hidden while snoozed or dismissed, and without gifts or date", () => {
    const now = new Date("2027-03-20T12:00:00Z");
    expect(giftReminderDue(row(), now)).toBe(true);
    expect(giftReminderDue(row({ allowGifts: false }), now)).toBe(false);
    expect(giftReminderDue(row({ giftDate: null }), now)).toBe(false);
    expect(giftReminderDue(row({ giftReminderDismissedAt: now }), now)).toBe(false);
    expect(giftReminderDue(row({ giftReminderSnoozedUntil: new Date("2027-03-21T00:00:00Z") }), now)).toBe(false);
    expect(giftReminderDue(row({ giftReminderSnoozedUntil: new Date("2027-03-19T00:00:00Z") }), now)).toBe(true);
  });
});
