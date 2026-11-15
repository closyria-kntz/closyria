import { describe, expect, it } from "vitest";
import type { AiBudget } from "./budget";
import type { ModelRequest, StructuredModel } from "./model";
import { AiUnavailableError } from "./model";
import { type AiOrderOutput, aiParseOrderEmail, MAX_AI_INPUT_CHARS } from "./order-email";

const now = () => new Date("2026-11-14T10:00:00Z");

/** An e-mail of an unknown shop format, with invented personal data. */
const TEXT = `Bonjour Camille,
Merci pour ta commande n° CMD-88213 passée le 9 novembre 2026 chez Atelier Pivoine.
Pantalon Arlo, taille 38, couleur sauge — 1 × 79,00 €
Livraison à : Camille Martin, 12 rue des Lilas, 69003 Lyon
Tél. 06 12 34 56 78 — camille.martin@exemple.test
Payé avec la carte 4970 1012 3456 7893
Envoyé avec Mondial Relay, colis 12345678`;

const ANSWER: AiOrderOutput = {
  isOrder: true,
  shopName: "Atelier Pivoine",
  orderNumber: "CMD-88213",
  orderDate: "2026-11-09",
  currency: "eur",
  lines: [{ name: "Pantalon Arlo", size: "38", color: "sauge", quantity: 1, price: 79 }],
  trackingNumbers: [{ number: "12345678", carrier: "Mondial Relay" }],
};
const USAGE = { input_tokens: 1200, output_tokens: 300 };

/** A fake model: records what it was sent, answers `output` (never the network). */
function fakeModel(output: unknown, usage = USAGE) {
  const sent: ModelRequest<unknown>[] = [];
  const model: StructuredModel = async (request) => {
    sent.push(request as ModelRequest<unknown>);
    return { output, usage };
  };
  return { model, sent };
}

/** A budget in memory with `capNano` left this month. */
function fakeBudget(capNano: number) {
  const state = { spent: 0, reservations: 0 };
  const budget: AiBudget = {
    async reserve(max) {
      if (state.spent + max > capNano) return null;
      state.spent += max;
      state.reservations += 1;
      return {
        async settle(cost) {
          state.spent += cost - max;
        },
      };
    },
  };
  return { budget, state };
}

describe("aiParseOrderEmail", () => {
  it("sends only the redacted text and returns the cleaned order", async () => {
    const { model, sent } = fakeModel(ANSWER);
    const { budget, state } = fakeBudget(1e9);
    const order = await aiParseOrderEmail(TEXT, { model, budget, now });

    const text = sent[0]?.text ?? "";
    for (const secret of ["rue des Lilas", "69003", "06 12 34 56 78", "camille.martin", "@", "4970 1012"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain("CMD-88213");
    expect(sent[0]?.system).toMatch(/never guess/i);

    expect(order).toEqual({
      shopName: "Atelier Pivoine",
      shopHost: null,
      externalRef: "CMD-88213",
      orderedAt: "2026-11-09T12:00:00.000Z",
      lines: [
        { name: "Pantalon Arlo", sizeLabel: "38", color: "sauge", quantity: 1, priceCents: 7900, currency: "EUR" },
      ],
      trackings: [{ trackingNumber: "12345678", carrier: "mondial_relay" }],
    });
    // Settled to the real cost: 1 200 × 100 + 300 × 500 billionths of a dollar.
    expect(state.spent).toBe(270_000);
  });

  it("keeps unknown fields null, never filled in", async () => {
    const { model } = fakeModel({
      ...ANSWER,
      shopName: null,
      orderDate: null,
      currency: null,
      lines: [{ name: "Pantalon Arlo", size: null, color: null, quantity: null, price: 79 }],
      trackingNumbers: [],
    });
    const order = await aiParseOrderEmail(TEXT, { model, budget: fakeBudget(1e9).budget, now });
    expect(order).toMatchObject({
      shopName: null,
      orderedAt: null,
      lines: [{ name: "Pantalon Arlo", sizeLabel: null, color: null, quantity: 1, priceCents: null, currency: null }],
      trackings: [],
    });
  });

  it("returns null without calling the model once the monthly cap would be passed", async () => {
    const { model, sent } = fakeModel(ANSWER);
    const { budget, state } = fakeBudget(1000);
    expect(await aiParseOrderEmail(TEXT, { model, budget, now })).toBeNull();
    expect(sent).toHaveLength(0);
    expect(state.reservations).toBe(0);
  });

  it("returns null for what is no order, a refusal or an answer of the wrong shape", async () => {
    for (const output of [{ ...ANSWER, isOrder: false }, null, { isOrder: true }, { ...ANSWER, lines: "x" }]) {
      const { model } = fakeModel(output);
      expect(await aiParseOrderEmail(TEXT, { model, budget: fakeBudget(1e9).budget, now })).toBeNull();
    }
    const nothing = fakeModel({ ...ANSWER, orderNumber: null, lines: [], trackingNumbers: [] });
    expect(await aiParseOrderEmail(TEXT, { model: nothing.model, budget: fakeBudget(1e9).budget, now })).toBeNull();
  });

  it("gives the reservation back and rethrows when the API is unavailable", async () => {
    const { budget, state } = fakeBudget(1e9);
    const model: StructuredModel = async () => {
      throw new AiUnavailableError("model unavailable (529)");
    };
    await expect(aiParseOrderEmail(TEXT, { model, budget, now })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(state.spent).toBe(0);
  });

  it("sends at most MAX_AI_INPUT_CHARS characters and nothing for an empty text", async () => {
    const { model, sent } = fakeModel(ANSWER);
    await aiParseOrderEmail(`${TEXT}\n${"mot ".repeat(MAX_AI_INPUT_CHARS)}\n${"x".repeat(MAX_AI_INPUT_CHARS)}`, {
      model,
      budget: fakeBudget(1e9).budget,
      now,
    });
    expect(sent[0]?.text.length).toBe(MAX_AI_INPUT_CHARS);
    expect(await aiParseOrderEmail("  \n ", { model, budget: fakeBudget(1e9).budget, now })).toBeNull();
    expect(sent).toHaveLength(1);
  });
});
