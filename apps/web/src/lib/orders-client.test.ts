import { describe, expect, it, vi } from "vitest";
import {
  addSenderAddress,
  fetchOrderInbox,
  fetchOrders,
  fetchSenderAddresses,
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
    expect(await resendSenderCode(id, deps(json({ error: "rate_limited" }, 429)))).toEqual({
      ok: false,
      error: "rate_limited",
    });
    const removed = deps(new Response(null, { status: 204 }));
    expect(await removeSenderAddress(id, removed)).toEqual({ ok: true });
    expect(removed.fetch).toHaveBeenCalledWith(`/api/me/order-inbox/senders/${id}`, { method: "DELETE" });
  });
});
