import { z } from "zod";
import { currencySchema } from "./catalog";
import { deviceKeySchema, friendNameSchema, textLength } from "./opinions";

export const groupOrderStatusSchema = z.enum(["open", "closed", "ordered", "cancelled"]);
export type GroupOrderStatus = z.infer<typeof groupOrderStatusSchema>;

/** Active lines one friend may have in one group order. */
export const GROUP_ORDER_MAX_LINES = 20;
export const GROUP_ORDER_MAX_QUANTITY = 5;
export const GROUP_ORDER_SHIPPING_LABEL_MAX = 40;
export const GROUP_ORDER_SIZE_LABEL_MAX = 40;
export const GROUP_ORDER_MANUAL_NAME_MAX = 120;

const centsSchema = z.int().min(0).max(100_000_000);
const dateTimeSchema = z.iso.datetime({ offset: true });

const labelSchema = z
  .string()
  .trim()
  .refine((v) => textLength(v) >= 1 && textLength(v) <= GROUP_ORDER_SHIPPING_LABEL_MAX, "label length");
const sizeLabelSchema = z
  .string()
  .trim()
  .max(GROUP_ORDER_SIZE_LABEL_MAX)
  .nullable()
  .transform((v) => (v === "" ? null : v));
const quantitySchema = z.int().min(1).max(GROUP_ORDER_MAX_QUANTITY);
const manualNameSchema = z.string().trim().min(1).max(GROUP_ORDER_MANUAL_NAME_MAX);
const webUrlSchema = z
  .url()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), "http(s) only");

const shippingSchema = z.object({
  label: labelSchema,
  shippingCents: centsSchema,
  freeFromCents: z.int().positive().max(100_000_000).nullable(),
});
export type GroupOrderShipping = z.infer<typeof shippingSchema>;

/** A shop's delivery option as the admin edits it. */
export const shippingOptionInputSchema = z.object({
  label: labelSchema,
  shippingCents: centsSchema,
  freeFromCents: z.int().positive().max(100_000_000).nullable(),
});
export type ShippingOptionInput = z.infer<typeof shippingOptionInputSchema>;

/** A shop's delivery option as the API returns it. */
export const shippingOptionSchema = shippingOptionInputSchema.extend({
  id: z.uuid(),
  position: z.int().min(0),
});
export type ShippingOption = z.infer<typeof shippingOptionSchema>;
export const shippingOptionListSchema = z.object({ options: z.array(shippingOptionSchema) });

const deadlineSchema = z.iso.date();

/** Open a group order: exactly one of a shop's option or free input for the delivery. */
export const groupOrderCreateSchema = z
  .object({
    shopId: z.uuid(),
    shippingOptionId: z.uuid().optional(),
    shipping: shippingSchema.optional(),
    deadline: deadlineSchema.nullable(),
  })
  .refine((v) => (v.shippingOptionId === undefined) !== (v.shipping === undefined), {
    error: "exactly one of shippingOptionId or shipping",
    path: ["shipping"],
  });
export type GroupOrderCreate = z.infer<typeof groupOrderCreateSchema>;

export const groupOrderPatchSchema = z
  .object({ deadline: deadlineSchema.nullable().optional(), shipping: shippingSchema.optional() })
  .refine((v) => v.deadline !== undefined || v.shipping !== undefined, "nothing to change");
export type GroupOrderPatch = z.infer<typeof groupOrderPatchSchema>;

export const groupOrderActionSchema = z.object({ action: z.enum(["close", "reopen", "cancel"]) });
export type GroupOrderAction = z.infer<typeof groupOrderActionSchema>;

/** « J'ai commandé »: the real shipping and the real price of each line. */
export const groupOrderOrderSchema = z.object({
  shippingCents: centsSchema,
  lines: z.array(z.object({ id: z.uuid(), priceCents: centsSchema })),
});
export type GroupOrderOrder = z.infer<typeof groupOrderOrderSchema>;

/** Her own lines: replaces all of them (items of the list and of the shop only). */
export const groupOrderOwnLinesSchema = z.object({
  lines: z
    .array(z.object({ itemId: z.uuid(), sizeLabel: sizeLabelSchema, quantity: quantitySchema }))
    .max(GROUP_ORDER_MAX_LINES),
});
export type GroupOrderOwnLines = z.infer<typeof groupOrderOwnLinesSchema>;

/** « Payé » ticked (true) or unticked (false) for one friend. */
export const groupOrderPaymentInputSchema = z.object({ paid: z.boolean() });

const friendLineCommon = {
  sizeLabel: sizeLabelSchema,
  quantity: quantitySchema,
  name: friendNameSchema,
  deviceKey: deviceKeySchema,
  claim: z.boolean().optional(),
};

export const friendLineInputSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("item"), itemId: z.uuid(), ...friendLineCommon }),
  z.object({ source: z.literal("url"), url: webUrlSchema, ...friendLineCommon }),
  z.object({
    source: z.literal("manual"),
    manualName: manualNameSchema,
    manualPriceCents: centsSchema,
    url: webUrlSchema.optional(),
    ...friendLineCommon,
  }),
]);
export type FriendLineInput = z.infer<typeof friendLineInputSchema>;

export const friendLinePatchSchema = z.object({
  sizeLabel: sizeLabelSchema,
  quantity: quantitySchema,
  manualName: manualNameSchema.optional(),
  manualPriceCents: centsSchema.optional(),
  name: friendNameSchema,
  deviceKey: deviceKeySchema,
});
export type FriendLinePatch = z.infer<typeof friendLinePatchSchema>;

export const friendLineDeleteSchema = z.object({ name: friendNameSchema, deviceKey: deviceKeySchema });
export type FriendLineDelete = z.infer<typeof friendLineDeleteSchema>;

export interface GroupOrderPerson {
  key: string;
  isOwner: boolean;
  /** One entry per active line: unit price × quantity, in cents. */
  linesCents: number[];
}

export interface GroupOrderTotals {
  totalCents: number;
  remainingForFreeCents: number | null;
  shippingTotalCents: number;
  perPerson: Record<string, { itemsCents: number; shippingCents: number; totalCents: number }>;
}

/**
 * The one place that splits the shipping. People come in display order; only those with at least one line take part.
 * Free shipping once the total reaches the threshold; otherwise an equal share, the remaining cents going to the
 * owner (if she takes part) or to the first person.
 */
export function computeGroupOrderTotals(input: {
  people: GroupOrderPerson[];
  shippingCents: number;
  freeFromCents: number | null;
}): GroupOrderTotals {
  const participants = input.people
    .filter((p) => p.linesCents.length > 0)
    .map((p) => ({ key: p.key, isOwner: p.isOwner, itemsCents: p.linesCents.reduce((n, c) => n + c, 0) }));
  const totalCents = participants.reduce((n, p) => n + p.itemsCents, 0);
  const free = input.freeFromCents !== null && totalCents >= input.freeFromCents;
  const remainingForFreeCents = input.freeFromCents === null ? null : Math.max(0, input.freeFromCents - totalCents);
  const count = participants.length;
  const base = free || count === 0 ? 0 : Math.floor(input.shippingCents / count);
  const rest = free || count === 0 ? 0 : input.shippingCents - base * count;
  const restKey = (participants.find((p) => p.isOwner) ?? participants[0])?.key;

  const perPerson: GroupOrderTotals["perPerson"] = {};
  let shippingTotalCents = 0;
  for (const p of participants) {
    const shippingCents = base + (p.key === restKey ? rest : 0);
    shippingTotalCents += shippingCents;
    perPerson[p.key] = { itemsCents: p.itemsCents, shippingCents, totalCents: p.itemsCents + shippingCents };
  }
  return { totalCents, remainingForFreeCents, shippingTotalCents, perPerson };
}

const lineStatusSchema = z.enum(["reading", "ready", "manual"]);
export type GroupOrderLineStatus = z.infer<typeof lineStatusSchema>;

const totalsSchema = z.object({
  totalCents: centsSchema,
  remainingForFreeCents: centsSchema.nullable(),
  shippingTotalCents: centsSchema,
});

/** What friends see of a group order on the shared link. */
export const sharedGroupOrderSchema = z.object({
  id: z.uuid(),
  shopName: z.string(),
  ownerName: z.string().nullable(),
  status: groupOrderStatusSchema,
  deadline: z.string().nullable(),
  locked: z.boolean(),
  shipping: shippingSchema,
  currency: currencySchema,
  totals: totalsSchema,
  people: z.array(
    z.object({
      name: z.string(),
      isOwner: z.boolean(),
      lines: z.array(
        z.object({
          id: z.uuid(),
          /** The item of the list it was taken from (« Je le prends aussi »); null for a link or her own entry. */
          itemId: z.uuid().nullable(),
          name: z.string(),
          imageUrl: z.string().nullable(),
          sizeLabel: z.string().nullable(),
          quantity: z.int(),
          unitPriceCents: centsSchema.nullable(),
          status: lineStatusSchema,
        }),
      ),
    }),
  ),
  eligibleItemIds: z.array(z.uuid()),
  /** Known size labels of each eligible item's product, in the shop's order; items without any are left out. */
  itemSizes: z.record(z.uuid(), z.array(z.string())),
  /** Only for the device attached to the name. */
  mine: z
    .object({
      name: z.string(),
      lineIds: z.array(z.uuid()),
      itemsCents: centsSchema,
      shippingCents: centsSchema,
      totalCents: centsSchema,
      provisional: z.boolean(),
      paidAt: dateTimeSchema.nullable(),
      removedLines: z.array(z.object({ id: z.uuid(), name: z.string() })),
    })
    .nullable(),
  orderedAt: dateTimeSchema.nullable(),
});
export type SharedGroupOrder = z.infer<typeof sharedGroupOrderSchema>;

/** What the owner sees of her group order. */
export const ownerGroupOrderSchema = z.object({
  id: z.uuid(),
  wishlistId: z.uuid(),
  shop: z.object({ id: z.uuid(), name: z.string() }),
  status: groupOrderStatusSchema,
  deadline: z.string().nullable(),
  shipping: shippingSchema,
  currency: currencySchema,
  totals: totalsSchema.extend({
    perPerson: z.record(
      z.string(),
      z.object({ itemsCents: centsSchema, shippingCents: centsSchema, totalCents: centsSchema }),
    ),
  }),
  people: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      isOwner: z.boolean(),
      lines: z.array(
        z.object({
          id: z.uuid(),
          /** Her item the line is for (her own lines, a friend's « Je le prends aussi »); null for a link or an entry. */
          itemId: z.uuid().nullable(),
          name: z.string(),
          imageUrl: z.string().nullable(),
          url: z.string().nullable(),
          sizeLabel: z.string().nullable(),
          quantity: z.int(),
          unitPriceCents: centsSchema.nullable(),
          finalPriceCents: centsSchema.nullable(),
          status: lineStatusSchema,
          removedAt: dateTimeSchema.nullable(),
        }),
      ),
      payment: z.object({ amountCents: centsSchema, paidAt: dateTimeSchema.nullable() }).nullable(),
    }),
  ),
  ownItems: z.array(
    z.object({ itemId: z.uuid(), name: z.string(), imageUrl: z.string().nullable(), sizes: z.array(z.string()) }),
  ),
  orderedAt: dateTimeSchema.nullable(),
  cancelledAt: dateTimeSchema.nullable(),
});
export type OwnerGroupOrder = z.infer<typeof ownerGroupOrderSchema>;

/** « Commandes groupées passées » of a list, most recent first. `totalCents`: items + shipping, frozen at « J'ai commandé ». */
export const groupOrderPastListSchema = z.object({
  past: z.array(
    z.object({
      id: z.uuid(),
      shopName: z.string(),
      status: groupOrderStatusSchema,
      currency: currencySchema,
      orderedAt: dateTimeSchema.nullable(),
      cancelledAt: dateTimeSchema.nullable(),
      totalCents: centsSchema,
      unpaidCount: z.int().min(0),
    }),
  ),
});
export type GroupOrderPastList = z.infer<typeof groupOrderPastListSchema>;
