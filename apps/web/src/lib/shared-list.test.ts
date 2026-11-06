import { describe, expect, it, vi } from "vitest";
import type { InternalApi } from "./admin-api";
import { fetchSharedList } from "./shared-list";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const view = {
  name: "Été",
  items: [
    {
      name: "Robe",
      brand: null,
      priceCents: 2999,
      currency: "EUR",
      imageUrl: "/api/catalog-images/x",
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
