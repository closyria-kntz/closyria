import { describe, expect, it, vi } from "vitest";
import { fetchOrderInbox, fetchOrders } from "./orders-client";

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
    const d = deps(json({ address: null, autoForward: true, pendingGmailCode: "123456" }));
    expect(await fetchOrderInbox(d)).toEqual({ address: null, autoForward: true, pendingGmailCode: "123456" });
    expect(d.ensure).not.toHaveBeenCalled();
  });

  it("reject a malformed answer or a server error", async () => {
    await expect(fetchOrders(deps(json({ orders: "no" })))).rejects.toThrow();
    await expect(fetchOrders(deps(json({}, 500)))).rejects.toThrow();
  });
});
