import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  alertEventViewSchema,
  alertKindSchema,
  alertSettingsPatchSchema,
  alertSettingsSchema,
  isRealDrop,
  nextSendAt,
  parisDay,
  parisHour,
  pushSubscriptionInputSchema,
  salePeriodInputSchema,
  salePeriodSchema,
  sizeCameBack,
  vapidConfig,
  vapidEnvIssues,
  vapidEnvShape,
  watchedSizes,
} from "./alerts";
import { itemAlertFieldsSchema } from "./wardrobe";

describe("isRealDrop", () => {
  it("counts 5 % as a real drop", () => {
    expect(isRealDrop(10000, 9500)).toBe(true);
  });
  it("counts 20 % as a real drop even under 5 €", () => {
    expect(isRealDrop(2000, 1600)).toBe(true);
  });
  it("counts 5 € as a real drop even under 5 %", () => {
    expect(isRealDrop(100000, 99500)).toBe(true);
  });
  it("ignores 4 % and 4 €", () => {
    expect(isRealDrop(10000, 9600)).toBe(false);
  });
  it("ignores a rise and no change", () => {
    expect(isRealDrop(10000, 10000)).toBe(false);
    expect(isRealDrop(0, 0)).toBe(false);
    expect(isRealDrop(10000, 12000)).toBe(false);
  });
});

describe("watchedSizes", () => {
  it("watches the item's own size first", () => {
    expect(watchedSizes("M", ["S", "L"], true)).toEqual(["M"]);
    expect(watchedSizes("TU", [], false)).toEqual(["TU"]);
  });
  it("else the profile's sizes for its kind", () => {
    expect(watchedSizes(null, ["38", "M"], true)).toEqual(["38", "M"]);
  });
  it("trims the profile's sizes and drops the blank ones", () => {
    expect(watchedSizes(null, [" M ", "", "  ", "38"], true)).toEqual(["M", "38"]);
    expect(watchedSizes(null, ["", " "], true)).toBe("any");
  });
  it("else any size", () => {
    expect(watchedSizes(null, [], true)).toBe("any");
    expect(watchedSizes("  ", [], true)).toBe("any");
  });
  it("any size for a kind without sizes", () => {
    expect(watchedSizes(null, ["38"], false)).toBe("any");
  });
});

describe("sizeCameBack", () => {
  it("finds her size back in stock", () => {
    expect(sizeCameBack({ M: false }, { M: true }, ["M"])).toEqual(["M"]);
  });
  it("matches a shop label written differently", () => {
    expect(sizeCameBack({ "38 FR": false }, { "38 FR": true }, ["38"])).toEqual(["38 FR"]);
  });
  it("ignores another size coming back", () => {
    expect(sizeCameBack({ M: false, L: false }, { M: false, L: true }, ["M"])).toEqual([]);
  });
  it("ignores another watched size coming back when one was already in stock", () => {
    expect(sizeCameBack({ M: true, L: false }, { M: true, L: true }, ["M", "L"])).toEqual([]);
  });
  it("ignores a size already in stock", () => {
    expect(sizeCameBack({ M: true }, { M: true }, ["M"])).toEqual([]);
  });
  it("ignores a new label when her size was already in stock under another one", () => {
    expect(sizeCameBack({ M: true }, { M: true, "S/M": true }, ["M"])).toEqual([]);
  });
  it("counts a size that appears for the first time", () => {
    expect(sizeCameBack({}, { M: true }, ["M"])).toEqual(["M"]);
  });
  it("any: back in stock after nothing in stock", () => {
    expect(sizeCameBack({}, { TU: true }, "any")).toEqual(["TU"]);
    expect(sizeCameBack({ S: false, M: false }, { S: true, M: false }, "any")).toEqual(["S"]);
  });
  it("any: nothing when something was already in stock", () => {
    expect(sizeCameBack({ S: true, M: false }, { S: true, M: true }, "any")).toEqual([]);
  });
  it("any: nothing when still out of stock", () => {
    expect(sizeCameBack({}, { M: false }, "any")).toEqual([]);
  });
});

describe("nextSendAt", () => {
  it("at 23:30 Paris waits until 8:00 the next day", () => {
    // 2026-11-14 23:30 Paris (UTC+1) = 22:30Z.
    expect(nextSendAt(new Date("2026-11-14T22:30:00Z")).toISOString()).toBe("2026-11-15T07:00:00.000Z");
  });
  it("at 22:00 Paris waits", () => {
    expect(nextSendAt(new Date("2026-11-14T21:00:00Z")).toISOString()).toBe("2026-11-15T07:00:00.000Z");
  });
  it("at 7:59 Paris waits until 8:00 the same day", () => {
    expect(nextSendAt(new Date("2026-11-14T06:59:00Z")).toISOString()).toBe("2026-11-14T07:00:00.000Z");
  });
  it("at 0:30 Paris waits until 8:00 the same day", () => {
    expect(nextSendAt(new Date("2026-11-13T23:30:00Z")).toISOString()).toBe("2026-11-14T07:00:00.000Z");
  });
  it("at 14:00 and 8:00 Paris sends now", () => {
    const at = new Date("2026-11-14T13:00:00Z");
    expect(nextSendAt(at).getTime()).toBe(at.getTime());
    const eight = new Date("2026-11-14T07:00:00Z");
    expect(nextSendAt(eight).getTime()).toBe(eight.getTime());
  });
  it("in summer time (UTC+2)", () => {
    // 2026-07-01 23:30 Paris = 21:30Z → 2026-07-02 8:00 Paris = 06:00Z.
    expect(nextSendAt(new Date("2026-07-01T21:30:00Z")).toISOString()).toBe("2026-07-02T06:00:00.000Z");
    const afternoon = new Date("2026-07-01T12:00:00Z");
    expect(nextSendAt(afternoon).getTime()).toBe(afternoon.getTime());
  });
  it("across the switch to summer time (night of 28–29 March 2026)", () => {
    // 2026-03-28 23:30 Paris (UTC+1) = 22:30Z → 2026-03-29 8:00 Paris (UTC+2) = 06:00Z.
    expect(nextSendAt(new Date("2026-03-28T22:30:00Z")).toISOString()).toBe("2026-03-29T06:00:00.000Z");
  });
  it("across the switch to winter time (night of 24–25 October 2026)", () => {
    // 2026-10-24 23:30 Paris (UTC+2) = 21:30Z → 2026-10-25 8:00 Paris (UTC+1) = 07:00Z.
    expect(nextSendAt(new Date("2026-10-24T21:30:00Z")).toISOString()).toBe("2026-10-25T07:00:00.000Z");
  });
});

describe("parisDay", () => {
  it("is the calendar day in Paris", () => {
    expect(parisDay(new Date("2026-11-14T22:30:00Z"))).toBe("2026-11-14");
    expect(parisDay(new Date("2026-11-14T23:30:00Z"))).toBe("2026-11-15");
    expect(parisDay(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
  });
});

describe("schemas", () => {
  it("alert kinds", () => {
    expect(alertKindSchema.options).toEqual(["size_back", "target_price", "price_drop", "sale_period", "shop_promo"]);
  });
  it("settings: digest hour between 8 and 21, out of the quiet hours", () => {
    const base = { sizeBack: true, targetPrice: true, digest: true };
    expect(alertSettingsSchema.safeParse({ ...base, digestHour: 18 }).success).toBe(true);
    expect(alertSettingsSchema.safeParse({ ...base, digestHour: 8 }).success).toBe(true);
    expect(alertSettingsSchema.safeParse({ ...base, digestHour: 21 }).success).toBe(true);
    expect(alertSettingsSchema.safeParse({ ...base, digestHour: 7 }).success).toBe(false);
    expect(alertSettingsSchema.safeParse({ ...base, digestHour: 22 }).success).toBe(false);
    expect(alertSettingsSchema.safeParse({ ...base, digestHour: 18.5 }).success).toBe(false);
    expect(alertSettingsPatchSchema.safeParse({ digestHour: 9 }).success).toBe(true);
    expect(alertSettingsPatchSchema.safeParse({}).success).toBe(false);
  });
  it("push subscription: an https endpoint and its keys", () => {
    const input = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      expirationTime: null,
      keys: {
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    };
    expect(pushSubscriptionInputSchema.safeParse(input).success).toBe(true);
    expect(pushSubscriptionInputSchema.safeParse({ ...input, endpoint: "http://example.test/x" }).success).toBe(false);
    expect(pushSubscriptionInputSchema.safeParse({ ...input, keys: { p256dh: "", auth: "x" } }).success).toBe(false);
  });
  it("sale period: end on or after start", () => {
    expect(
      salePeriodInputSchema.safeParse({ name: "Soldes d'hiver", startsOn: "2027-01-13", endsOn: "2027-02-09" }).success,
    ).toBe(true);
    expect(
      salePeriodInputSchema.safeParse({ name: "Un jour", startsOn: "2027-01-13", endsOn: "2027-01-13" }).success,
    ).toBe(true);
    expect(
      salePeriodInputSchema.safeParse({ name: "À l'envers", startsOn: "2027-01-13", endsOn: "2027-01-12" }).success,
    ).toBe(false);
    expect(salePeriodInputSchema.safeParse({ name: " ", startsOn: "2027-01-13", endsOn: "2027-01-14" }).success).toBe(
      false,
    );
    expect(
      salePeriodSchema.safeParse({
        id: "6f1c1e0e-7a51-4b8f-9a39-0e2a5b1d2c3f",
        name: "Soldes d'été",
        startsOn: "2027-06-23",
        endsOn: "2027-07-20",
      }).success,
    ).toBe(true);
  });
  it("item fields: target price at least 1 cent, null clears it", () => {
    expect(itemAlertFieldsSchema.safeParse({ targetPriceCents: 6000 }).success).toBe(true);
    expect(itemAlertFieldsSchema.safeParse({ targetPriceCents: null }).success).toBe(true);
    expect(itemAlertFieldsSchema.safeParse({ targetPriceCents: 0 }).success).toBe(false);
    expect(itemAlertFieldsSchema.safeParse({ alertsEnabled: false }).success).toBe(true);
  });
  it("event view", () => {
    const view = {
      id: "6f1c1e0e-7a51-4b8f-9a39-0e2a5b1d2c3f",
      kind: "size_back",
      itemId: "6f1c1e0e-7a51-4b8f-9a39-0e2a5b1d2c40",
      title: "Robe Iris",
      shopName: "Atelier Margaux",
      sizeLabel: "M",
      priceCents: null,
      previousCents: null,
      targetPriceCents: null,
      currency: null,
      salePeriodName: null,
      startsOn: null,
      photoUrl: null,
      href: "/articles/6f1c1e0e-7a51-4b8f-9a39-0e2a5b1d2c40",
      createdAt: "2026-11-14T10:00:00.000Z",
      readAt: null,
    };
    expect(alertEventViewSchema.safeParse(view).success).toBe(true);
    expect(alertEventViewSchema.safeParse({ ...view, kind: "other" }).success).toBe(false);
    expect(alertEventViewSchema.safeParse({ ...view, href: "//evil.test/x" }).success).toBe(false);
    expect(alertEventViewSchema.safeParse({ ...view, href: "https://evil.test/x" }).success).toBe(false);
  });
});

/** A fresh P-256 key pair in the VAPID format (base64url, uncompressed public point). */
function testVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(pub.x ?? "", "base64url"),
    Buffer.from(pub.y ?? "", "base64url"),
  ]);
  return { publicKey: point.toString("base64url"), privateKey: priv.d ?? "" };
}

describe("VAPID configuration", () => {
  const keys = testVapidKeys();
  const full = {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: "https://closyria.com",
  };
  const parse = (env: Record<string, string>) => {
    const parsed = z.object(vapidEnvShape).parse(env);
    return { parsed, issues: vapidEnvIssues(parsed) };
  };

  it("all three set: push on", () => {
    const { parsed, issues } = parse(full);
    expect(issues).toEqual([]);
    expect(vapidConfig(parsed)).toEqual({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "https://closyria.com",
    });
  });

  it("none set: push off, no issue", () => {
    const { parsed, issues } = parse({});
    expect(issues).toEqual([]);
    expect(vapidConfig(parsed)).toBeNull();
  });

  it("some set: an issue for each missing one", () => {
    const { issues } = parse({ VAPID_PUBLIC_KEY: keys.publicKey });
    expect(issues.map((i) => i.path)).toEqual(["VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
  });

  it("refuses malformed keys and subjects", () => {
    const schema = z.object(vapidEnvShape);
    expect(schema.safeParse({ ...full, VAPID_PUBLIC_KEY: keys.privateKey }).success).toBe(false);
    expect(schema.safeParse({ ...full, VAPID_PRIVATE_KEY: keys.publicKey }).success).toBe(false);
    expect(schema.safeParse({ ...full, VAPID_PRIVATE_KEY: `${keys.privateKey.slice(0, 42)}=` }).success).toBe(false);
    expect(schema.safeParse({ ...full, VAPID_SUBJECT: "http://closyria.com" }).success).toBe(false);
    expect(schema.safeParse({ ...full, VAPID_SUBJECT: "mailto:bonjour@closyria.com" }).success).toBe(true);
  });
});

describe("parisHour", () => {
  it("reads the wall-clock hour in Paris, winter and summer", () => {
    expect(parisHour(new Date("2026-11-14T17:00:00Z"))).toBe(18);
    expect(parisHour(new Date("2026-07-14T16:00:00Z"))).toBe(18);
    expect(parisHour(new Date("2026-11-14T23:30:00Z"))).toBe(0);
  });
});
