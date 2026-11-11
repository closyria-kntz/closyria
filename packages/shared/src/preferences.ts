import { z } from "zod";

/** A tip's id (`home-levels`…): lowercase words joined by dashes. */
export const tipIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(40);

/** At most this many closed tips are kept on an account (the oldest are forgotten first). */
export const MAX_SEEN_TIPS = 200;

/**
 * What her account remembers between devices (refonte Boudoir, spec R8): the tips she closed and when she went
 * through (or skipped) the first-opening discovery; null while she has not.
 */
export const preferencesViewSchema = z.object({
  seenTips: z.array(tipIdSchema),
  onboardedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type PreferencesView = z.infer<typeof preferencesViewSchema>;

/** `seenTips` are added to the ones already closed; `onboarded: true` marks the discovery done (kept if already). */
export const preferencesPatchSchema = z
  .object({
    seenTips: z.array(tipIdSchema).min(1).max(20).optional(),
    onboarded: z.literal(true).optional(),
  })
  .strict()
  .refine((patch) => patch.seenTips !== undefined || patch.onboarded !== undefined, {
    message: "nothing to change",
  });
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;
