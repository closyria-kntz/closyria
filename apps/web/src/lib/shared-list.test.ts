import { DEFAULT_LOVE_LEVELS, sharedWishlistViewSchema } from "@closyria/shared";
import { describe, expect, it, vi } from "vitest";
import type { InternalApi } from "./admin-api";
import {
  addGroupLine,
  deleteGroupLine,
  deleteOpinion,
  fetchSharedList,
  fetchSharedView,
  giveGift,
  leaveGift,
  patchGroupLine,
  putOpinion,
  withGiftsHidden,
} from "./shared-list";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const view = {
  name: "Été",
  ownerName: null,
  allowOpinions: true,
  viewerIsOwner: false,
  gifts: { open: false, occasion: null, date: null },
  givenItems: [],
  groupOrder: null,
  levels: DEFAULT_LOVE_LEVELS,
  budget: null,
  items: [
    {
      itemId: "5b1f3c0e-7c1a-4d58-9a39-0a3f2f3a1b11",
      ownerOpinion: null,
      opinions: [],
      name: "Robe",
      brand: null,
      priceCents: 2999,
      currency: "EUR",
      imageUrl: "/api/catalog-images/x",
      imageWidth: 600,
      imageHeight: 800,
      gift: null,
      size: null,
      shopName: "Boutique",
      url: "https://shop.test/robe",
    },
  ],
};
const api = (response: Response): InternalApi & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async () => response),
  baseUrl: "http://127.0.0.1:3001",
  cookie: "session=secret",
});

describe("withGiftsHidden", () => {
  it("keeps no gift state nor giver name for the server's paint", () => {
    const [base] = view.items;
    if (!base) throw new Error("no item");
    const open = {
      ...view,
      gifts: { open: true, occasion: null, date: null },
      items: [
        { ...base, gift: { state: "reserved" as const, reserver: "Léa", contributors: ["Inès"], mine: null } },
        {
          ...base,
          itemId: "5b1f3c0e-7c1a-4d58-9a39-0a3f2f3a1b12",
          gift: { state: "owner_took" as const, givers: ["Zoé"], mine: null },
        },
        {
          ...base,
          itemId: "5b1f3c0e-7c1a-4d58-9a39-0a3f2f3a1b13",
          gift: { state: "removed" as const, mine: { role: "reserver" as const, name: "Léa" } },
        },
        { ...base, itemId: "5b1f3c0e-7c1a-4d58-9a39-0a3f2f3a1b14", gift: { state: "free" as const } },
      ],
    };
    const hidden = withGiftsHidden(sharedWishlistViewSchema.parse(open));
    expect(hidden.items.map((i) => i.gift)).toEqual([{ state: "hidden" }, { state: "hidden" }, { state: "hidden" }]);
    for (const name of ["Léa", "Inès", "Zoé"]) expect(JSON.stringify(hidden)).not.toContain(name);
    expect(withGiftsHidden(sharedWishlistViewSchema.parse(view)).items[0]?.gift).toBeNull();
  });
});

describe("fetchSharedList", () => {
  it("reads the list from the public API route, without the visitor's cookie", async () => {
    const internal = api(Response.json(view));
    const result = await fetchSharedList(internal, TOKEN);
    expect(result).toEqual({ ok: true, data: view });
    const [url, init] = internal.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:3001/api/shared/${TOKEN}`);
    expect(JSON.stringify(init.headers)).not.toContain("secret");
  });

  it("answers not found for a stopped share", async () => {
    expect(await fetchSharedList(api(Response.json({ error: "not_found" }, { status: 404 })), TOKEN)).toEqual({
      ok: false,
      status: 404,
    });
  });

  it("never calls the API with something that is not a token", async () => {
    const internal = api(Response.json(view));
    expect(await fetchSharedList(internal, "../admin/shops")).toEqual({ ok: false, status: 404 });
    expect(internal.fetch).not.toHaveBeenCalled();
  });

  it("throws when the API fails", async () => {
    await expect(fetchSharedList(api(new Response("", { status: 500 })), TOKEN)).rejects.toThrow();
  });
});

const ITEM = "5b1f3c0e-7c1a-4d58-9a39-0a3f2f3a1b11";
const KEY = "AAAAAAAAAAAAAAAAAAAAAA";
const opinion = {
  id: "6c2f3c0e-7c1a-4d58-9a39-0a3f2f3a1b12",
  name: "Léa",
  level: 4,
  note: null,
  createdAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
  isNew: false,
};
const browserFetch = (response: Response) => vi.fn(async (_url: string, _init?: RequestInit) => response);

describe("the friend's calls", () => {
  it("reads the list again with same-origin credentials (dev's password), null once the link stopped", async () => {
    const fetcher = browserFetch(Response.json(view));
    expect(await fetchSharedView(TOKEN, null, fetcher as unknown as typeof fetch)).toEqual(view);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/shared/${TOKEN}`);
    expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
    const gone = browserFetch(Response.json({ error: "not_found" }, { status: 404 }));
    expect(await fetchSharedView(TOKEN, null, gone as unknown as typeof fetch)).toBeNull();
    expect(fetcher.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it("sends her device key when it has one, so her gifts show as hers", async () => {
    const fetcher = browserFetch(Response.json(view));
    await fetchSharedView(TOKEN, KEY, fetcher as unknown as typeof fetch);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ "x-device-key": KEY });
  });

  it("puts an opinion and reads back the saved one", async () => {
    const fetcher = browserFetch(Response.json(opinion));
    const input = { name: "Léa", level: 4, note: null, deviceKey: KEY };
    expect(await putOpinion(TOKEN, ITEM, input, fetcher as unknown as typeof fetch)).toEqual({ ok: true, opinion });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/shared/${TOKEN}/items/${ITEM}/opinion`);
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("names the API's refusals, anything else is « failed »", async () => {
    const input = { name: "Léa", level: 4, note: null, deviceKey: KEY };
    for (const [status, error] of [
      [409, "name_taken"],
      [422, "web_address"],
      [429, "rate_limited"],
      [403, "opinions_closed"],
    ] as const) {
      const fetcher = browserFetch(Response.json({ error }, { status }));
      expect(await putOpinion(TOKEN, ITEM, input, fetcher as unknown as typeof fetch)).toEqual({ ok: false, error });
    }
    const odd = browserFetch(Response.json({ error: "invalid_request" }, { status: 400 }));
    expect(await putOpinion(TOKEN, ITEM, input, odd as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "failed",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await putOpinion(TOKEN, ITEM, input, offline as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "failed",
    });
  });

  it("erases an opinion; a key that did not write it is « forbidden »", async () => {
    const done = browserFetch(new Response(null, { status: 204 }));
    const input = { name: "Léa", deviceKey: KEY };
    expect(await deleteOpinion(TOKEN, ITEM, input, done as unknown as typeof fetch)).toEqual({ ok: true });
    expect(done.mock.calls[0]?.[1]?.method).toBe("DELETE");
    const other = browserFetch(Response.json({ error: "forbidden" }, { status: 403 }));
    expect(await deleteOpinion(TOKEN, ITEM, input, other as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("the friend's gifts", () => {
  const input = { name: "Léa", deviceKey: KEY, intent: "reserve" as const };

  it("offers an item and reads back her role", async () => {
    const fetcher = browserFetch(Response.json({ role: "reserver" }));
    expect(await giveGift(TOKEN, ITEM, input, fetcher as unknown as typeof fetch)).toEqual({
      ok: true,
      role: "reserver",
    });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/shared/${TOKEN}/items/${ITEM}/gift`);
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("says who reserved just before, and names the other refusals", async () => {
    const race = browserFetch(Response.json({ error: "already_reserved", reserver: "Inès" }, { status: 409 }));
    expect(await giveGift(TOKEN, ITEM, input, race as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "already_reserved",
      reserver: "Inès",
    });
    for (const [status, error] of [
      [409, "name_taken"],
      [409, "owner_took"],
      [403, "gifts_closed"],
      [404, "not_found"],
      [429, "rate_limited"],
    ] as const) {
      const fetcher = browserFetch(Response.json({ error }, { status }));
      expect(await giveGift(TOKEN, ITEM, input, fetcher as unknown as typeof fetch)).toEqual({ ok: false, error });
    }
    const odd = browserFetch(Response.json({ error: "invalid_request" }, { status: 400 }));
    expect(await giveGift(TOKEN, ITEM, input, odd as unknown as typeof fetch)).toEqual({ ok: false, error: "failed" });
  });

  it("takes back her gift", async () => {
    const done = browserFetch(new Response(null, { status: 204 }));
    const leave = { name: "Léa", deviceKey: KEY };
    expect(await leaveGift(TOKEN, ITEM, leave, done as unknown as typeof fetch)).toEqual({ ok: true });
    expect(done.mock.calls[0]?.[1]?.method).toBe("DELETE");
    const other = browserFetch(Response.json({ error: "forbidden" }, { status: 403 }));
    expect(await leaveGift(TOKEN, ITEM, leave, other as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("the friend's group order lines", () => {
  const LINE = "3f0d2b8e-5a71-4c6b-8a3e-2f4b5c6d7e8f";
  const input = {
    source: "item" as const,
    itemId: ITEM,
    sizeLabel: "T38",
    quantity: 1,
    name: "Léa",
    deviceKey: KEY,
  };

  it("adds a line and reads back its id", async () => {
    const fetcher = browserFetch(Response.json({ lineId: LINE }, { status: 201 }));
    expect(await addGroupLine(TOKEN, input, fetcher as unknown as typeof fetch)).toEqual({ ok: true, lineId: LINE });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/shared/${TOKEN}/group-order/lines`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("names the refusals, with the shop of the order for a link from elsewhere", async () => {
    const elsewhere = browserFetch(Response.json({ error: "not_in_shop", shopName: "Zara" }, { status: 400 }));
    expect(await addGroupLine(TOKEN, input, elsewhere as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "not_in_shop",
      shopName: "Zara",
    });
    for (const [status, code, error] of [
      [403, "group_order_locked", "locked"],
      [409, "name_taken", "name_taken"],
      [409, "too_many_lines", "too_many"],
      [400, "not_eligible", "not_eligible"],
      [409, "currency_mismatch", "currency"],
      [403, "forbidden", "forbidden"],
      [429, "rate_limited", "rate_limited"],
      [400, "invalid_request", "failed"],
    ] as const) {
      const fetcher = browserFetch(Response.json({ error: code }, { status }));
      expect(await addGroupLine(TOKEN, input, fetcher as unknown as typeof fetch)).toEqual({ ok: false, error });
    }
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await addGroupLine(TOKEN, input, down as unknown as typeof fetch)).toEqual({ ok: false, error: "failed" });
  });

  it("changes and takes out one of her lines", async () => {
    const changed = browserFetch(Response.json({ lineId: LINE }));
    const patch = { sizeLabel: null, quantity: 2, name: "Léa", deviceKey: KEY };
    expect(await patchGroupLine(TOKEN, LINE, patch, changed as unknown as typeof fetch)).toEqual({
      ok: true,
      lineId: LINE,
    });
    expect(changed.mock.calls[0]?.[0]).toBe(`/api/shared/${TOKEN}/group-order/lines/${LINE}`);
    expect(changed.mock.calls[0]?.[1]?.method).toBe("PATCH");
    const gone = browserFetch(new Response(null, { status: 204 }));
    expect(
      await deleteGroupLine(TOKEN, LINE, { name: "Léa", deviceKey: KEY }, gone as unknown as typeof fetch),
    ).toEqual({ ok: true, lineId: LINE });
    expect(gone.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });
});
