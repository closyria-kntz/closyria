import { z } from "zod";

/** Closed list of audience events, completed by each chantier. */
export const eventNames = [
  "page_view",
  "signup_started",
  "signup_completed",
  "item_saved",
  "item_stage_changed",
  "item_moved",
  "wishlist_shared",
  "account_prompt_shown",
  "account_created_from_prompt",
] as const;
export type EventName = (typeof eventNames)[number];

export const deviceFamilies = ["mobile", "desktop", "tablet"] as const;
export type DeviceFamily = (typeof deviceFamilies)[number];

/** Limits of one request and of one event (also published in the OpenAPI document). */
export const MAX_EVENTS_PER_BATCH = 20;
export const MAX_PATH_LENGTH = 200;
export const MAX_PROPS_KEYS = 10;
export const MAX_PROPS_KEY_LENGTH = 40;
export const MAX_PROPS_VALUE_LENGTH = 200;
/** Events older than this, or further in the future than the tolerance, are refused. */
export const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_EVENT_FUTURE_MS = 5 * 60 * 1000;

/** Flat, small, non-personal context: strings, numbers and booleans only. */
export const eventPropsSchema = z
  .record(
    z.string().max(MAX_PROPS_KEY_LENGTH),
    z.union([z.string().max(MAX_PROPS_VALUE_LENGTH), z.number(), z.boolean()]),
  )
  .refine((props) => Object.keys(props).length <= MAX_PROPS_KEYS, { error: `At most ${MAX_PROPS_KEYS} keys` });

/** A path only: query strings and fragments can carry personal data, so they are cut here, not trusted to the client. */
export const eventPathSchema = z
  .string()
  .max(MAX_PATH_LENGTH + 200) // room for a query string we are going to drop
  .regex(/^\//)
  .transform((value) => value.split(/[?#]/, 1)[0] ?? "/")
  .pipe(z.string().max(MAX_PATH_LENGTH));

export const eventSchema = z.object({
  name: z.enum(eventNames),
  path: eventPathSchema,
  occurredAt: z.iso.datetime(),
  props: eventPropsSchema.optional(),
});
export type AudienceEvent = z.infer<typeof eventSchema>;

export const eventBatchSchema = z.object({
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;

/** Stable error codes of `POST /api/events`. */
export const eventErrorCodes = ["invalid_event", "payload_too_large", "rate_limited"] as const;
export const eventErrorSchema = z.object({ error: z.enum(eventErrorCodes) });
export type EventErrorCode = (typeof eventErrorCodes)[number];

/**
 * Device family from a user agent, which is read once and never stored. iPhone and Android phones are
 * `mobile`; iPad and Android without the `Mobile` token are `tablet`; everything else (and no user agent) is `desktop`.
 */
export function deviceFromUserAgent(userAgent: string | null | undefined): DeviceFamily {
  const ua = userAgent ?? "";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/iPhone|iPod/i.test(ua)) return "mobile";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "mobile" : "tablet";
  return "desktop";
}
