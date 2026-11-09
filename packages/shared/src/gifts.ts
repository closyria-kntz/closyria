import { z } from "zod";
import { containsWebAddress, deviceKeySchema, friendNameSchema, textLength } from "./opinions";

export const GIFT_OCCASION_MAX = 40;
/** Code-point cap for the database check (one grapheme can be several code points). */
export const GIFT_OCCASION_MAX_CODE_POINTS = GIFT_OCCASION_MAX * 8;

/** What she clicked: « Je lui offre » (`reserve`) or « Je participe » (`join`). */
export const giftIntentSchema = z.enum(["reserve", "join"]);
export type GiftIntent = z.infer<typeof giftIntentSchema>;

export const giftInputSchema = z.object({
  name: friendNameSchema,
  deviceKey: deviceKeySchema,
  intent: giftIntentSchema,
  claim: z.boolean().optional(),
});
export type GiftInput = z.infer<typeof giftInputSchema>;

export const giftDeleteSchema = z.object({ name: friendNameSchema, deviceKey: deviceKeySchema });
export type GiftDelete = z.infer<typeof giftDeleteSchema>;

export const giftOccasionSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      textLength(value) >= 1 &&
      textLength(value) <= GIFT_OCCASION_MAX &&
      [...value].length <= GIFT_OCCASION_MAX_CODE_POINTS,
    "occasion length",
  )
  .refine((value) => !containsWebAddress(value), "no web address");

export const giftDateSchema = z.iso.date();

const giftRoleSchema = z.enum(["reserver", "contributor"]);
export type GiftRole = z.infer<typeof giftRoleSchema>;

/** This device's part in a gift: her role and the name she gives under (what « Me retirer » sends back). */
const giftMineSchema = z.object({ role: giftRoleSchema, name: z.string() });
export type GiftMine = z.infer<typeof giftMineSchema>;

export const sharedGiftStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("free") }),
  z.object({
    state: z.literal("reserved"),
    reserver: z.string(),
    contributors: z.array(z.string()),
    mine: giftMineSchema.nullable(),
  }),
  z.object({ state: z.literal("owner_took"), givers: z.array(z.string()), mine: giftMineSchema.nullable() }),
  z.object({ state: z.literal("removed"), mine: giftMineSchema }),
]);
export type SharedGiftState = z.infer<typeof sharedGiftStateSchema>;

export const sharedGiftsSchema = z.object({
  open: z.boolean(),
  occasion: z.string().nullable(),
  date: z.string().nullable(),
});
export type SharedGifts = z.infer<typeof sharedGiftsSchema>;

/** Most items a gift check or « pris elle-même » covers in one call (as the bulk actions). */
export const MAX_GIFT_CHECK_ITEMS = 200;

/** `GET /me/items/gift-check?ids=a,b`: up to 200 distinct item ids, comma-separated. */
export const giftCheckQuerySchema = z.object({
  ids: z
    .string()
    .max(MAX_GIFT_CHECK_ITEMS * 37)
    .transform((value) => value.split(","))
    .pipe(
      z
        .array(z.uuid())
        .min(1)
        .max(MAX_GIFT_CHECK_ITEMS)
        .refine((ids) => new Set(ids).size === ids.length, "ids must be unique"),
    ),
});

/** `POST /me/items/gift-took`: she takes these items herself (« Je le prends quand même »). */
export const giftTookSchema = z.object({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(MAX_GIFT_CHECK_ITEMS)
    .refine((ids) => new Set(ids).size === ids.length, "ids must be unique"),
});
export type GiftTook = z.infer<typeof giftTookSchema>;

/** Only ids: never who reserved. */
export const giftCheckSchema = z.object({ reserved: z.array(z.uuid()) });
export type GiftCheck = z.infer<typeof giftCheckSchema>;

export const giftReminderActionSchema = z.object({ action: z.enum(["snooze", "dismiss"]) });
export type GiftReminderAction = z.infer<typeof giftReminderActionSchema>;

/** The owner's gift settings on a list (all optional in a patch; occasion and date can be cleared). */
export const giftSettingsPatchSchema = z.object({
  allowGifts: z.boolean().optional(),
  giftOccasion: giftOccasionSchema.nullable().optional(),
  giftDate: giftDateSchema.nullable().optional(),
});
