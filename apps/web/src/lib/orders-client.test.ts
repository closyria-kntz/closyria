import { describe, expect, it, vi } from "vitest";
import {
  addSenderAddress,
  deleteParcel,
  fetchOrderInbox,
  fetchOrders,
  fetchSenderAddresses,
  patchParcel,
  removeSenderAddress,
  resendSenderCode,
  verifySenderAddress,
} from "./orders-client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const deps = (response: Response) => ({ fetch: vi.fn(async () => response), ensure: vi.fn(async () => {}) });

describe("orders reads", () => {
  it("never open a session (a visit to « Accueil » makes no guest), and answer « guest » without an account", async () => {
    for (const status of [401, 403]) {
      const d = deps(json({ error: "account_required" }, status));
      expect(await fetchOrders(d)).toBe("guest");
      expect(d.ensure).not.toHaveBeenCalled();
    }
    const d = deps(json({ receiving: true, address: null, autoForward: true, pendingGmailCode: "123456" }));
    expect(await fetchOrderInbox(d)).toEqual({
      receiving: true,
      address: null,
      autoForward: true,
      pendingGmailCode: "123456",
    });
    expect(d.ensure).not.toHaveBeenCalled();
  });

  it("reject a malformed answer or a server error", async () => {
    await expect(fetchOrders(deps(json({ orders: "no" })))).rejects.toThrow();
    await expect(fetchOrders(deps(json({}, 500)))).rejects.toThrow();
  });
});

describe("« Mes adresses d'envoi »", () => {
  const id = "7a0c3c58-7c3b-4d0e-9a5e-1f7d1b0f3c11";
  const view = { id, email: "marie@hotmail.example", verified: false, createdAt: "2026-11-15T10:00:00.000Z" };

  it("reads her addresses without opening a session, « guest » without an account", async () => {
    const list = { accountEmail: "marie@gmail.example", max: 10, addresses: [view] };
    const d = deps(json(list));
    expect(await fetchSenderAddresses(d)).toEqual(list);
    expect(d.fetch).toHaveBeenCalledWith("/api/me/order-inbox/senders", expect.anything());
    expect(d.ensure).not.toHaveBeenCalled();
    expect(await fetchSenderAddresses(deps(json({ error: "account_required" }, 403)))).toBe("guest");
  });

  it("adds, verifies, resends and removes, with their error codes", async () => {
    const added = deps(json(view, 201));
    expect(await addSenderAddress("marie@hotmail.example", added)).toMatchObject({ ok: true, id, verified: false });
    expect(added.fetch).toHaveBeenCalledWith(
      "/api/me/order-inbox/senders",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "marie@hotmail.example" }) }),
    );
    expect(await addSenderAddress("x", deps(json({ error: "sender_limit" }, 409)))).toEqual({
      ok: false,
      error: "sender_limit",
    });
    const verified = deps(json({ ...view, verified: true }));
    expect(await verifySenderAddress(id, "048213", verified)).toMatchObject({ ok: true, verified: true });
    expect(verified.fetch).toHaveBeenCalledWith(
      `/api/me/order-inbox/senders/${id}/verify`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "048213" }) }),
    );
    expect(await verifySenderAddress(id, "000000", deps(json({ error: "code_wrong" }, 422)))).toEqual({
      ok: false,
      error: "code_wrong",
    });
    expect(await resendSenderCode(id, deps(json({ error: "rate_limited", retryAfterSeconds: 3540 }, 429)))).toEqual({
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: 3540,
    });
    expect(await addSenderAddress("x@y.example", deps(json({ error: "rate_limited" }, 429)))).toEqual({
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: null,
    });
    const removed = deps(new Response(null, { status: 204 }));
    expect(await removeSenderAddress(id, removed)).toEqual({ ok: true });
    expect(removed.fetch).toHaveBeenCalledWith(`/api/me/order-inbox/senders/${id}`, { method: "DELETE" });
  });
});

describe("« Modifier le numéro » and « Supprimer ce suivi »", () => {
  const orderId = "7a0c3c58-7c3b-4d0e-9a5e-1f7d1b0f3c11";
  const parcelId = "0b8f0f8e-3f41-4b9e-8a0e-5c1d2e3f4a5b";
  const order = {
    id: orderId,
    profileId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    shop: null,
    shopName: "Lola & Co",
    externalRef: null,
    orderedAt: null,
    status: "confirmed",
    source: "email",
    parseMethod: "ai",
    lines: [],
    parcels: [],
    receivedQuestion: false,
    createdAt: "2026-11-15T09:00:00.000Z",
  };

  it("sends the new number to the parcel and answers the order", async () => {
    const d = deps(json(order));
    const result = await patchParcel(orderId, parcelId, { trackingNumber: "6A18537412398" }, d);
    expect(result).toMatchObject({ ok: true, order: { id: orderId, shopName: "Lola & Co" } });
    const [path, init] = d.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(`/api/me/orders/${orderId}/parcels/${parcelId}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ trackingNumber: "6A18537412398" });
  });

  it("keeps the API's reason for a refused number", async () => {
    const d = deps(json({ error: "parcel_exists" }, 409));
    expect(await patchParcel(orderId, parcelId, { trackingNumber: "6A18537412398" }, d)).toEqual({
      ok: false,
      error: "parcel_exists",
    });
  });

  it("deletes the parcel and answers the order", async () => {
    const d = deps(json(order));
    expect(await deleteParcel(orderId, parcelId, d)).toMatchObject({ ok: true, order: { id: orderId } });
    const [path, init] = d.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(`/api/me/orders/${orderId}/parcels/${parcelId}`);
    expect(init.method).toBe("DELETE");
  });
});
