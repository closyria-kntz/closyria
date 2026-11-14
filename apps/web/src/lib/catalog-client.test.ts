import { describe, expect, it, vi } from "vitest";
import { createCapture, fetchProduct, fetchSummary, readSummary, saveManual } from "./catalog-client";

const id = "00000000-0000-4000-8000-000000000001";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const deps = (response: Response) => ({ fetch: vi.fn(async () => response), ensure: vi.fn(async () => {}) });

describe("createCapture", () => {
  it("posts the url after making sure there is a session", async () => {
    const d = deps(json({ productId: id, captureId: id, status: "queued" }, 202));
    const result = await createCapture("https://a.fr/p", d);
    expect(result).toEqual({ ok: true, productId: id, captureId: id });
    expect(d.ensure).toHaveBeenCalled();
    expect(d.fetch).toHaveBeenCalledWith(
      "/api/captures",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://a.fr/p" }) }),
    );
  });

  it("maps 400 and 429 to their error", async () => {
    expect(await createCapture("x", deps(json({ error: "invalid_url" }, 400)))).toEqual({
      ok: false,
      error: "invalid_url",
    });
    expect(await createCapture("x", deps(json({ error: "rate_limited" }, 429)))).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  it("falls back to a generic error on anything else, or a bad body", async () => {
    expect(await createCapture("x", deps(json({}, 500)))).toEqual({ ok: false, error: "failed" });
    expect(await createCapture("x", deps(json({ nope: 1 }, 202)))).toEqual({ ok: false, error: "failed" });
    const broken = { fetch: vi.fn().mockRejectedValue(new Error("offline")), ensure: vi.fn(async () => {}) };
    expect(await createCapture("x", broken)).toEqual({ ok: false, error: "failed" });
  });
});

describe("fetchProduct", () => {
  it("returns not_found on 404 and rejects a body that does not match the schema", async () => {
    expect(await fetchProduct(id, deps(json({ error: "not_found" }, 404)))).toBe("not_found");
    await expect(fetchProduct(id, deps(json({ id: "x" })))).rejects.toThrow();
  });
});

describe("saveManual", () => {
  it("reports rate limiting", async () => {
    const result = await saveManual(id, { name: "Robe", sizes: [] }, deps(json({ error: "rate_limited" }, 429)));
    expect(result).toEqual({ ok: false, error: "rate_limited" });
  });
});

describe("fetchSummary", () => {
  const summary = {
    isAnonymous: true,
    account: { email: null, firstName: null, createdAt: "2026-11-07T08:00:00.000Z" },
    itemCount: 0,
    profiles: [],
  };

  it("reads the validated summary, without opening a session", async () => {
    const d = deps(json(summary));
    expect(await fetchSummary(d)).toEqual(summary);
    expect(d.fetch).toHaveBeenCalledWith("/api/me/summary", expect.objectContaining({ cache: "no-store" }));
    expect(d.ensure).not.toHaveBeenCalled();
  });

  it("is null without a session or with an unexpected answer", async () => {
    expect(await fetchSummary(deps(json({ error: "unauthorized" }, 401)))).toBeNull();
    expect(await fetchSummary(deps(json({ nope: 1 })))).toBeNull();
  });

  it("tells a visitor without any session (401) from a failed read", async () => {
    expect(await readSummary(deps(json(summary)))).toEqual({ kind: "ok", summary });
    expect(await readSummary(deps(json({ error: "unauthorized" }, 401)))).toEqual({ kind: "signed-out" });
    expect(await readSummary(deps(json({}, 500)))).toEqual({ kind: "failed" });
    expect(await readSummary(deps(json({ nope: 1 })))).toEqual({ kind: "failed" });
    const offline = { fetch: vi.fn(async () => Promise.reject(new TypeError("offline"))), ensure: vi.fn() };
    expect(await readSummary(offline)).toEqual({ kind: "failed" });
  });
});
