import { LISTING_CONDITIONS } from "@closyria/shared";
import { describe, expect, it, vi } from "vitest";
import {
  acceptErrors,
  acceptInvitation,
  fetchInvitation,
  invitationUrl,
  manageUrl,
  requestBody,
  requestErrors,
  sendListingRequest,
  withdrawShop,
} from "./listing";

const TOKEN = "a".repeat(43);
const version = LISTING_CONDITIONS.version;
const ok = { name: "Léa", email: "lea@lune.fr", authorized: true, accepted: true, version };
const answer = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("listing links", () => {
  it("builds the invitation and management addresses", () => {
    expect(invitationUrl("https://closyria.com", TOKEN)).toBe(`https://closyria.com/referencement/${TOKEN}`);
    expect(manageUrl("https://closyria.com", TOKEN)).toBe(`https://closyria.com/referencement/gerer/${TOKEN}`);
  });

  it("never asks the API about a malformed token", async () => {
    const fetchImpl = vi.fn();
    const api = { fetch: fetchImpl, baseUrl: "http://api", cookie: "s=1" };
    expect(await fetchInvitation(api, "../admin")).toEqual({ ok: false, status: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads the invitation without the visitor's cookies", async () => {
    const fetchImpl = answer(200, { shop: { name: "Lune", domain: "lune.fr" }, conditions: { version, sha256: "x" } });
    const api = { fetch: fetchImpl as unknown as typeof fetch, baseUrl: "http://api", cookie: "s=1" };
    const result = await fetchInvitation(api, TOKEN);
    expect(result.ok).toBe(true);
    const init = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[0]).toBe(`http://api/api/listing/invitations/${TOKEN}`);
    expect((init[1].headers as Record<string, string>).cookie).toBe("");
  });
});

describe("form checks", () => {
  it("lists the fields to fix in the form's order", () => {
    expect(acceptErrors(ok)).toEqual([]);
    expect(acceptErrors({ ...ok, name: " ", accepted: false })).toEqual(["name", "accepted"]);
    expect(acceptErrors({ ...ok, email: "lea", authorized: false })).toEqual(["email", "authorized"]);
  });

  it("checks the request's site and drops an empty message", () => {
    const request = { ...ok, shopName: "Lune", siteUrl: "lune.fr", message: "  ", website: "" };
    expect(requestErrors(request)).toEqual([]);
    expect(requestBody(request)).not.toHaveProperty("message");
    expect(requestBody(request)).not.toHaveProperty("website");
    expect(requestErrors({ ...request, siteUrl: "pas un site", shopName: "" })).toEqual(["shopName", "siteUrl"]);
  });
});

describe("sending", () => {
  it("returns the management token of an acceptance", async () => {
    const result = await acceptInvitation(TOKEN, ok, answer(201, { shopName: "Lune", manageToken: "b".repeat(43) }));
    expect(result).toEqual({ ok: true, data: { shopName: "Lune", manageToken: "b".repeat(43) } });
  });

  it("tells a used link, too many tries and a failure apart", async () => {
    expect(await acceptInvitation(TOKEN, ok, answer(404))).toEqual({ ok: false, error: "invalid" });
    expect(await acceptInvitation(TOKEN, ok, answer(429))).toEqual({ ok: false, error: "tooMany" });
    expect(await withdrawShop(TOKEN, answer(500))).toEqual({ ok: false, error: "failed" });
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(
      await sendListingRequest({ ...ok, shopName: "L", siteUrl: "l.fr", message: "", website: "" }, offline),
    ).toEqual({ ok: false, error: "failed" });
  });
});
