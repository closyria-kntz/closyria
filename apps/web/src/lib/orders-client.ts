import {
  type Carrier,
  type InstagramItemInput,
  itemMutationResultSchema,
  type ManualOrderInput,
  type OrderInboxView,
  type OrderList,
  type OrderPatch,
  type OrderReceivedAnswer,
  orderInboxViewSchema,
  orderListSchema,
  orderViewSchema,
  type SenderAddressList,
  senderAddressListSchema,
  senderAddressViewSchema,
  senderRateLimitedSchema,
  type TrackingInput,
} from "@closyria/shared";
import { z } from "zod";
import type { ClientDeps } from "./catalog-client";
import { call, callNoContent, defaultDeps, jsonInit } from "./wardrobe-client";

/**
 * « Après la commande » (Task 7): her order address, her orders and what she does with them, the Instagram short form.
 * Orders are for accounts only: a guest's reads answer `"guest"` (the page asks her to create her account).
 */

/** The short form of an Instagram link (`?lien=` carries the link). */
export const INSTAGRAM_FORM_PATH = "/ajouter/instagram";

export type GuestOr<T> = T | "guest";

async function read<T>(
  deps: ClientDeps,
  path: string,
  parse: (body: unknown) => T,
  signal?: AbortSignal,
): Promise<GuestOr<T>> {
  // A read never opens a session: a visit alone (her home) must not make a guest account.
  const response = await deps.fetch(path, { cache: "no-store", signal: signal ?? null });
  if (response.status === 403 || response.status === 401) return "guest";
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return parse(await response.json());
}

/** Her order address (null before she has one) and Gmail's confirmation code. Throws on a network error. */
export function fetchOrderInbox(deps: ClientDeps = defaultDeps): Promise<GuestOr<OrderInboxView>> {
  return read(deps, "/api/me/order-inbox", (body) => orderInboxViewSchema.parse(body));
}

/** Her first address, or a new one (« Changer d'adresse »: the former one stops at once). */
export function newOrderInbox(deps: ClientDeps = defaultDeps) {
  return call(deps, "/api/me/order-inbox", { method: "POST" }, orderInboxViewSchema);
}

/** « Mes adresses d'envoi »: her account address and those she added. Throws on a network error. */
export function fetchSenderAddresses(deps: ClientDeps = defaultDeps): Promise<GuestOr<SenderAddressList>> {
  return read(deps, "/api/me/order-inbox/senders", (body) => senderAddressListSchema.parse(body));
}

const SENDERS = "/api/me/order-inbox/senders";

/**
 * A request that sends a code: as `call`, and a refusal for too many codes says how long to wait
 * (`retryAfterSeconds`, read from the 429's body).
 */
async function sendingCall(deps: ClientDeps, path: string, init: RequestInit) {
  let retryAfterSeconds: number | null = null;
  const watched: ClientDeps = {
    ...deps,
    fetch: async (input, options) => {
      const response = await deps.fetch(input, options);
      if (response.status === 429) {
        const parsed = senderRateLimitedSchema.safeParse(
          await response
            .clone()
            .json()
            .catch(() => null),
        );
        if (parsed.success) retryAfterSeconds = parsed.data.retryAfterSeconds;
      }
      return response;
    },
  };
  const result = await call(watched, path, init, senderAddressViewSchema);
  return !result.ok && result.error === "rate_limited" ? { ...result, retryAfterSeconds } : result;
}

/** « Ajouter une adresse »: a code leaves for it. */
export const addSenderAddress = (email: string, deps: ClientDeps = defaultDeps) =>
  sendingCall(deps, SENDERS, jsonInit("POST", { email }));

export const verifySenderAddress = (id: string, code: string, deps: ClientDeps = defaultDeps) =>
  call(deps, `${SENDERS}/${id}/verify`, jsonInit("POST", { code }), senderAddressViewSchema);

/** « Renvoyer le code ». */
export const resendSenderCode = (id: string, deps: ClientDeps = defaultDeps) =>
  sendingCall(deps, `${SENDERS}/${id}/resend`, { method: "POST" });

/** « Retirer ». */
export const removeSenderAddress = (id: string, deps: ClientDeps = defaultDeps) =>
  callNoContent(deps, `${SENDERS}/${id}`, { method: "DELETE" });

/** Her orders to validate, her orders and her unreadable e-mails. Throws on a network error. */
export function fetchOrders(deps: ClientDeps = defaultDeps, signal?: AbortSignal): Promise<GuestOr<OrderList>> {
  return read(deps, "/api/me/orders", (body) => orderListSchema.parse(body), signal);
}

/** The order answered, as `{ order }`: its own `status` must not meet the HTTP status `call` adds. */
const orderAnswerSchema = z.preprocess((body) => ({ order: body }), z.object({ order: orderViewSchema }));

const orderCall = (deps: ClientDeps, path: string, init: RequestInit) => call(deps, path, init, orderAnswerSchema);

export const patchOrder = (id: string, patch: OrderPatch, deps: ClientDeps = defaultDeps) =>
  orderCall(deps, `/api/me/orders/${id}`, jsonInit("PATCH", patch));

export const confirmOrder = (id: string, deps: ClientDeps = defaultDeps) =>
  orderCall(deps, `/api/me/orders/${id}/confirm`, { method: "POST" });

export const dismissOrder = (id: string, deps: ClientDeps = defaultDeps) =>
  orderCall(deps, `/api/me/orders/${id}/dismiss`, { method: "POST" });

export const answerReceived = (id: string, answer: OrderReceivedAnswer["answer"], deps: ClientDeps = defaultDeps) =>
  orderCall(deps, `/api/me/orders/${id}/received`, jsonInit("POST", { answer }));

export const createManualOrder = (input: ManualOrderInput, deps: ClientDeps = defaultDeps) =>
  orderCall(deps, "/api/me/orders", jsonInit("POST", input));

/** « Ajouter un numéro de suivi » on her article « Commandé ». */
export const addItemTracking = (itemId: string, input: TrackingInput, deps: ClientDeps = defaultDeps) =>
  orderCall(deps, `/api/me/items/${itemId}/tracking`, jsonInit("POST", input));

/** « Changer de transporteur » on one of her parcels. */
export const changeParcelCarrier = (
  orderId: string,
  parcelId: string,
  carrier: Carrier,
  deps: ClientDeps = defaultDeps,
) => orderCall(deps, `/api/me/orders/${orderId}/parcels/${parcelId}`, jsonInit("PATCH", { carrier }));

/** « Ce n'est pas une commande » on an e-mail nothing could read. */
export const dismissUnreadEmail = (id: string, deps: ClientDeps = defaultDeps) =>
  call(deps, `/api/me/order-emails/${id}/dismiss`, { method: "POST" }, orderListSchema);

/** The short form of an Instagram link: an article without a product. */
export const createInstagramItem = (input: InstagramItemInput, deps: ClientDeps = defaultDeps) =>
  call(deps, "/api/me/items/instagram", jsonInit("POST", input), itemMutationResultSchema);
