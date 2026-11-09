import { z } from "zod";
import { containsWebAddress, deviceKeySchema, friendNameSchema, textLength } from "./opinions";

export const GIFT_OCCASION_MAX = 40;
/** Code-point cap for the database check (one grapheme can be several code points). */
export const GIFT_OCCASION_MAX_CODE_POINTS = GIFT_OCCASION_MAX * 8;

export const giftInputSchema = z.object({
  name: friendNameSchema,
  deviceKey: deviceKeySchema,
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

export const sharedGiftStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("free") }),
  z.object({
    state: z.literal("reserved"),
    reserver: z.string(),
    contributors: z.array(z.string()),
    mine: giftRoleSchema.nullable(),
  }),
  z.object({ state: z.literal("owner_took"), givers: z.array(z.string()), mine: giftRoleSchema.nullable() }),
  z.object({ state: z.literal("removed"), mine: giftRoleSchema }),
]);
export type SharedGiftState = z.infer<typeof sharedGiftStateSchema>;

export const sharedGiftsSchema = z.object({
  open: z.boolean(),
  occasion: z.string().nullable(),
  date: z.string().nullable(),
});
export type SharedGifts = z.infer<typeof sharedGiftsSchema>;

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
