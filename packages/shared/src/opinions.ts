import { z } from "zod";
import { loveLevelSchema } from "./love-level";

export const OPINION_NAME_MAX = 40;
export const OPINION_NOTE_MAX = 200;

const dateTimeSchema = z.iso.datetime({ offset: true });
const segmenter = new Intl.Segmenter("fr", { granularity: "grapheme" });

/** Length in graphemes, so an emoji or a family counts as one character. */
export function textLength(value: string): number {
  let count = 0;
  for (const _ of segmenter.segment(value)) count += 1;
  return count;
}

/** What makes two friends' names « the same »: trimmed, single-spaced, lower-cased. */
export function opinionNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

const WEB_ADDRESS = /(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|fr|net|org|io|shop|store|co|eu|be|ch|ca|uk|de|it|es)\b/i;
export function containsWebAddress(text: string): boolean {
  return WEB_ADDRESS.test(text);
}

export const deviceKeySchema = z
  .string()
  .min(22)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const opinionNameSchema = z
  .string()
  .trim()
  .refine((value) => textLength(value) >= 1 && textLength(value) <= OPINION_NAME_MAX, "name length");

export const opinionInputSchema = z.object({
  name: opinionNameSchema,
  level: loveLevelSchema,
  note: z
    .string()
    .refine((value) => textLength(value) <= OPINION_NOTE_MAX, "note length")
    .nullable(),
  deviceKey: deviceKeySchema,
  claim: z.boolean().optional(),
});
export type OpinionInput = z.infer<typeof opinionInputSchema>;

export const opinionDeleteSchema = z.object({ name: opinionNameSchema, deviceKey: deviceKeySchema });
export type OpinionDelete = z.infer<typeof opinionDeleteSchema>;

export const opinionViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  level: loveLevelSchema,
  note: z.string().nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  /** Always false on the public view. */
  isNew: z.boolean(),
});
export type OpinionView = z.infer<typeof opinionViewSchema>;

/** An opinion she erased, with its list item: what « Annuler » sends back to restore it as it was. */
export const erasedOpinionSchema = opinionViewSchema.extend({
  itemId: z.uuid(),
  name: opinionNameSchema,
  note: z
    .string()
    .refine((value) => textLength(value) <= OPINION_NOTE_MAX, "note length")
    .nullable(),
});
export type ErasedOpinion = z.infer<typeof erasedOpinionSchema>;

export const wishlistSettingsSchema = z.object({
  allowOpinions: z.boolean(),
  showOwnerName: z.boolean(),
  showOwnerOpinions: z.boolean(),
  showBudget: z.boolean(),
});
export type WishlistSettings = z.infer<typeof wishlistSettingsSchema>;

export const shareLinkSchema = z.object({ url: z.string().nullable(), legacy: z.boolean() });
export type ShareLink = z.infer<typeof shareLinkSchema>;

export const wishlistOpinionsSchema = z.object({
  items: z.array(z.object({ itemId: z.uuid(), opinions: z.array(opinionViewSchema) })),
});
export type WishlistOpinions = z.infer<typeof wishlistOpinionsSchema>;

export const itemOpinionsSchema = z.object({
  lists: z.array(z.object({ wishlistId: z.uuid(), wishlistName: z.string(), opinions: z.array(opinionViewSchema) })),
});
export type ItemOpinions = z.infer<typeof itemOpinionsSchema>;
