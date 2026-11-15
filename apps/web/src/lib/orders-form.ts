import {
  bareItemHref,
  MAX_TRACKING_NUMBER,
  MIN_TRACKING_NUMBER,
  normalizeTrackingNumber,
  type OrderLineInput,
  type OrderLineView,
} from "@closyria/shared";
import { parsePriceCents } from "./price";

export type { ClientError } from "./wardrobe-client";

/**
 * What the order forms of « Après la commande » (Task 7) check before sending: the tracking number, and the articles
 * she corrects or types (« Corriger », « Saisir la commande »).
 */

/** A tracking number as the API takes it: 6 to 40 letters and digits once spaces and dashes are gone. */
export function isTrackingInput(raw: string): boolean {
  const n = normalizeTrackingNumber(raw);
  return n.length >= MIN_TRACKING_NUMBER && n.length <= MAX_TRACKING_NUMBER && /^[0-9A-Z]+$/.test(n);
}

/** One article as the form holds it: texts as she typed them. */
export type LineDraft = { name: string; sizeLabel: string; color: string; quantity: string; price: string };

export const emptyLine = (): LineDraft => ({ name: "", sizeLabel: "", color: "", quantity: "1", price: "" });

/** A line of the order, back into the form (the price of one piece, in euros). */
export function lineDraftOf(line: OrderLineView): LineDraft {
  return {
    name: line.name,
    sizeLabel: line.sizeLabel ?? "",
    color: line.color ?? "",
    quantity: String(line.quantity),
    price: line.priceCents === null ? "" : (line.priceCents / 100).toFixed(2).replace(".", ","),
  };
}

export type LinesCheck =
  | { ok: true; lines: OrderLineInput[] }
  /** `index`: the line at fault, so the form ties the message to its field. */
  | { ok: false; error: "name" | "price"; index: number };

/**
 * Her articles as the API takes them: a name each, a quantity of 1 to 99 (1 when unreadable), a price in euros or
 * none (a price keeps the line's currency, euros for a typed one).
 */
export function checkLines(drafts: readonly LineDraft[], currencies: readonly (string | null)[] = []): LinesCheck {
  const lines: OrderLineInput[] = [];
  for (const [index, draft] of drafts.entries()) {
    const name = draft.name.trim();
    if (!name) return { ok: false, error: "name", index };
    const price = parsePriceCents(draft.price);
    if (!price.ok) return { ok: false, error: "price", index };
    const quantity = Number.parseInt(draft.quantity, 10);
    const cents = price.cents ?? null;
    lines.push({
      name,
      sizeLabel: draft.sizeLabel.trim() || null,
      color: draft.color.trim() || null,
      quantity: Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : 1,
      priceCents: cents,
      currency: cents === null ? null : (currencies[index] ?? "EUR"),
    });
  }
  return { ok: true, lines };
}

/** Where a line of a validated order leads: its article's sheet (its product's, or its own without a product). */
export function lineHref(line: Pick<OrderLineView, "itemId" | "productId">): string | null {
  if (line.productId) return `/produits/${line.productId}`;
  return line.itemId ? bareItemHref(line.itemId) : null;
}

/**
 * The article « Ajouter un numéro de suivi » goes through (the API joins the number to its order): one still
 * « Commandé ». Once received (« Oui », a delivery) or none left, the action is not offered.
 */
export const trackableItem = (order: { lines: readonly Pick<OrderLineView, "itemId" | "itemStage">[] }) =>
  order.lines.find((l) => l.itemId !== null && l.itemStage === "ordered")?.itemId ?? null;
