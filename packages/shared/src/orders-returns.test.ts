import { describe, expect, it } from "vitest";
import { alertKindSchema, IMMEDIATE_ALERT_KINDS, parisDayStart, UNCAPPED_ALERT_KINDS } from "./alerts";
import { isInstagramUrl, isMetaHost, isMetaUrl } from "./catalog-url";
import {
  addParisDays,
  instagramCaptureSchema,
  instagramItemInputSchema,
  orderReceivedAnswerSchema,
  parisDaysBetween,
  RECEIVED_QUESTION_AGAIN_DAYS,
  RECEIVED_QUESTION_DAYS,
  RETURN_REMINDER_DAYS,
  receivedQuestionDue,
} from "./orders";
import { wardrobeErrorCodes } from "./wardrobe";

const DAY = 86_400_000;

describe("Paris days", () => {
  it("adds calendar days, across months and years", () => {
    expect(addParisDays("2026-11-15", 3)).toBe("2026-11-18");
    expect(addParisDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addParisDays("2026-03-28", 1)).toBe("2026-03-29");
  });
  it("counts the calendar days between two days", () => {
    expect(parisDaysBetween("2026-11-15", "2026-11-18")).toBe(3);
    expect(parisDaysBetween("2026-11-18", "2026-11-15")).toBe(-3);
    expect(parisDaysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
  it("reminds 3 days before the deadline, asks at 10 and 20 days", () => {
    expect(RETURN_REMINDER_DAYS).toBe(3);
    expect(RECEIVED_QUESTION_DAYS).toBe(10);
    expect(RECEIVED_QUESTION_AGAIN_DAYS).toBe(20);
  });
});

describe("receivedQuestionDue", () => {
  const now = new Date("2026-11-15T08:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const base = { askedAt: null, notYetAt: null, askedAgainAt: null };

  it("asks once 10 days after the reference date", () => {
    expect(receivedQuestionDue({ ...base, referenceAt: ago(9) }, now)).toBeNull();
    expect(receivedQuestionDue({ ...base, referenceAt: ago(10) }, now)).toBe("first");
    expect(receivedQuestionDue({ ...base, referenceAt: ago(12), askedAt: ago(2) }, now)).toBeNull();
  });
  it("after « Pas encore », asks again at 20 days, once; then stops", () => {
    const answered = { ...base, askedAt: ago(9), notYetAt: ago(8) };
    expect(receivedQuestionDue({ ...answered, referenceAt: ago(19) }, now)).toBeNull();
    expect(receivedQuestionDue({ ...answered, referenceAt: ago(20) }, now)).toBe("again");
    expect(receivedQuestionDue({ ...answered, referenceAt: ago(25), askedAgainAt: ago(5) }, now)).toBeNull();
  });
  it("counts Paris calendar days: shipped at 15:00 on the 5th, asked at 9:00 on the 15th (and the 25th)", () => {
    const shipped = new Date("2026-11-05T15:00:00+01:00");
    const at9 = (day: string) => new Date(`${day}T09:00:00+01:00`);
    expect(receivedQuestionDue({ ...base, referenceAt: shipped }, at9("2026-11-14"))).toBeNull();
    expect(receivedQuestionDue({ ...base, referenceAt: shipped }, at9("2026-11-15"))).toBe("first");
    const answered = { askedAt: at9("2026-11-15"), notYetAt: at9("2026-11-16"), askedAgainAt: null };
    expect(receivedQuestionDue({ ...answered, referenceAt: shipped }, at9("2026-11-24"))).toBeNull();
    expect(receivedQuestionDue({ ...answered, referenceAt: shipped }, at9("2026-11-25"))).toBe("again");
    // Late in the evening, Paris time (already the next day in UTC terms is irrelevant: Paris days count).
    const lateShipped = new Date("2026-11-05T23:30:00+01:00");
    expect(receivedQuestionDue({ ...base, referenceAt: lateShipped }, at9("2026-11-15"))).toBe("first");
  });
  it("across the change to winter time (25 October 2026)", () => {
    // 20 October 15:00 Paris (UTC+2) → asked on 30 October 9:00 Paris (UTC+1).
    const shipped = new Date("2026-10-20T15:00:00+02:00");
    expect(receivedQuestionDue({ ...base, referenceAt: shipped }, new Date("2026-10-29T09:00:00+01:00"))).toBeNull();
    expect(receivedQuestionDue({ ...base, referenceAt: shipped }, new Date("2026-10-30T09:00:00+01:00"))).toBe("first");
    // Shipped at 00:30 Paris on the 20th (still the 19th in UTC): the 20th counts.
    const night = new Date("2026-10-20T00:30:00+02:00");
    expect(receivedQuestionDue({ ...base, referenceAt: night }, new Date("2026-10-30T09:00:00+01:00"))).toBe("first");
    expect(parisDayStart("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(parisDayStart("2026-10-26").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
  it("without an answer to the first question, never asks again", () => {
    expect(receivedQuestionDue({ ...base, referenceAt: ago(40), askedAt: ago(30) }, now)).toBeNull();
  });
});

describe("schemas", () => {
  it("adds the return reminder and the received question, both immediate", () => {
    expect(alertKindSchema.options).toContain("return_reminder");
    expect(alertKindSchema.options).toContain("order_received_check");
    expect(IMMEDIATE_ALERT_KINDS).toContain("return_reminder");
    expect(IMMEDIATE_ALERT_KINDS).toContain("order_received_check");
    // Order and parcel kinds never count toward the daily cap.
    expect([...UNCAPPED_ALERT_KINDS]).toEqual([
      "order_received",
      "parcel_out_for_delivery",
      "parcel_pickup_ready",
      "parcel_delivered",
      "return_reminder",
      "order_received_check",
    ]);
  });
  it("answers « Oui » or « Pas encore »", () => {
    expect(orderReceivedAnswerSchema.safeParse({ answer: "yes" }).success).toBe(true);
    expect(orderReceivedAnswerSchema.safeParse({ answer: "not_yet" }).success).toBe(true);
    expect(orderReceivedAnswerSchema.safeParse({ answer: "no" }).success).toBe(false);
    expect(orderReceivedAnswerSchema.safeParse({}).success).toBe(false);
    expect(wardrobeErrorCodes).toContain("order_not_confirmed");
  });
});

describe("Instagram", () => {
  it("recognises Instagram's hosts only", () => {
    expect(isInstagramUrl("https://www.instagram.com/p/C0ffee/")).toBe(true);
    expect(isInstagramUrl("https://instagram.com/maisonlune")).toBe(true);
    expect(isInstagramUrl("https://INSTAGRAM.COM/p/x")).toBe(true);
    expect(isInstagramUrl("https://instagr.am/p/x")).toBe(true);
    expect(isInstagramUrl("https://m.instagram.com/p/x")).toBe(true);
    expect(isInstagramUrl("http://www.instagram.com./p/x")).toBe(true);
    expect(isInstagramUrl("https://instagram.com.evil.test/p/x")).toBe(false);
    expect(isInstagramUrl("https://notinstagram.com/p/x")).toBe(false);
    expect(isInstagramUrl("https://maison-lune.fr/products/robe")).toBe(false);
    expect(isInstagramUrl("ftp://instagram.com/x")).toBe(false);
    expect(isInstagramUrl("not a url")).toBe(false);
  });
  it("recognises Meta's hosts, Instagram's photo CDNs included, strictly", () => {
    for (const host of [
      "instagram.com",
      "www.instagram.com",
      "instagr.am",
      "cdninstagram.com",
      "scontent-cdg4-1.cdninstagram.com",
      "fbcdn.net",
      "scontent.xx.fbcdn.net",
      "FBCDN.NET.",
    ]) {
      expect(isMetaHost(host), host).toBe(true);
    }
    for (const host of ["notfbcdn.net", "fbcdn.net.evil.test", "cdninstagram.com.evil.test", "shop.test"]) {
      expect(isMetaHost(host), host).toBe(false);
    }
    expect(isMetaUrl("https://scontent.cdninstagram.com/v/photo.jpg")).toBe(true);
    expect(isMetaUrl("https://maison-lune.fr/photo.jpg")).toBe(false);
    expect(isMetaUrl("data:image/png;base64,xx")).toBe(false);
  });
  it("the capture answer tells the client to show the short form", () => {
    expect(instagramCaptureSchema.parse({ form: "instagram", url: "https://www.instagram.com/p/x" }).form).toBe(
      "instagram",
    );
  });
  it("the short form: an Instagram link, a name, and her own fields", () => {
    const url = "https://www.instagram.com/p/C0ffee/";
    const parsed = instagramItemInputSchema.parse({
      url,
      action: "ordered",
      name: " Robe Iris ",
      brand: "Maison Lune",
      priceCents: 4500,
      sizeLabel: "38",
      notes: "Vue en story",
    });
    expect(parsed.name).toBe("Robe Iris");
    expect(instagramItemInputSchema.safeParse({ url, action: "wish", name: "Robe" }).success).toBe(true);
    expect(instagramItemInputSchema.safeParse({ url, action: "wish", name: " " }).success).toBe(false);
    expect(
      instagramItemInputSchema.safeParse({ url: "https://maison-lune.fr/p", action: "wish", name: "Robe" }).success,
    ).toBe(false);
    // What she paid only for an article she ordered.
    expect(instagramItemInputSchema.safeParse({ url, action: "wish", name: "Robe", priceCents: 4500 }).success).toBe(
      false,
    );
    expect(instagramItemInputSchema.safeParse({ url, action: "owned", name: "Robe" }).success).toBe(false);
  });
});
