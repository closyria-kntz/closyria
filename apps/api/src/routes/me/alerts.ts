import { and, type Database, desc, eq, gte, inArray, isNull, type SQL, schema, sql } from "@closyria/db";
import {
  ALERTS_DAYS,
  ALERTS_PAGE_HREF,
  ALERTS_PAGE_SIZE,
  type AlertEventView,
  type AlertKind,
  type AlertPage,
  type AlertSettings,
  alertItemHref,
  alertPageSchema,
  alertReadInputSchema,
  alertReadResultSchema,
  alertSettingsPatchSchema,
  alertSettingsSchema,
  DEFAULT_ALERT_SETTINGS,
  ITEM_ALERT_KINDS,
  type PushSubscriptionView,
  pushKeySchema,
  pushSubscriptionInputSchema,
  pushSubscriptionListSchema,
  pushSubscriptionViewSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { catalogImageUrl } from "../../catalog/product-view";
import type { WardrobeDeps } from "../../wardrobe/deps";
import { InvalidCursorError, privateMediaUrl, validKeyValue } from "../../wardrobe/item-view";

/** Web Push, as configured at startup: the VAPID public key, or null when push is off (no VAPID_* variables). */
export type PushDeps = { publicKey: string | null };

const invalidRequest = { error: "invalid_request" } as const;
const notFound = { error: "not_found" } as const;
const accountRequired = { error: "account_required" } as const;
const invalidCursor = { error: "invalid_cursor" } as const;
/** Longest device name kept (the browser's User-Agent). */
const MAX_USER_AGENT = 300;

const json = <S extends z.ZodType>(description: string, schema: S) => ({
  description,
  content: { "application/json": { schema } },
});
const errorContent = (description: string) => json(description, wardrobeErrorSchema);
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const accountRequiredContent = errorContent("A guest: create an account first (account_required)");

const keyRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/push/key",
    summary: "The VAPID public key browsers subscribe with",
    responses: {
      200: json("Push is on", pushKeySchema),
      404: errorContent("Push is off on this server (not_found)"),
    },
  }),
  "public",
);

const listSubscriptionsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/push-subscriptions",
    summary: "Her devices that receive notifications",
    responses: { 200: json("Newest first", pushSubscriptionListSchema) },
  }),
  "user",
);

const subscribeRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/push-subscriptions",
    summary: "Subscribe this browser to her notifications",
    description:
      "One row per endpoint: subscribing again updates the keys and the device name. A browser already subscribed " +
      "for another account moves to hers (that account's alerts no longer reach this device). Guests are refused.",
    request: body(pushSubscriptionInputSchema),
    responses: {
      200: json("Subscribed", pushSubscriptionViewSchema),
      400: errorContent("Invalid body (invalid_request)"),
      403: accountRequiredContent,
    },
  }),
  "user",
);

const unsubscribeRoute = defineAccess(
  createRoute({
    method: "delete",
    path: "/me/push-subscriptions/{id}",
    summary: "Remove one of her devices (« Retirer »)",
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      204: { description: "Removed" },
      404: errorContent("Unknown or another account's device (not_found)"),
    },
  }),
  "user",
);

const getSettingsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/alert-settings",
    summary: "Her notification settings",
    description: "Everything on and the digest at 18:00 until she changes them (guests always read these).",
    responses: { 200: json("Her settings", alertSettingsSchema) },
  }),
  "user",
);

const patchSettingsRoute = defineAccess(
  createRoute({
    method: "patch",
    path: "/me/alert-settings",
    summary: "Change her notification settings",
    description: "At least one field; the digest hour is 8–21 (Paris). Guests are refused.",
    request: body(alertSettingsPatchSchema),
    responses: {
      200: json("Her settings", alertSettingsSchema),
      400: errorContent("Invalid body (invalid_request)"),
      403: accountRequiredContent,
    },
  }),
  "user",
);

const listAlertsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/me/alerts",
    summary: "« Nouvelles »: her alerts of the last 30 days",
    description:
      `Newest first, ${ALERTS_PAGE_SIZE} a page, whether they were pushed, put in a digest or never sent. An item's ` +
      "alert leads to its sheet in the item's current profile.",
    request: { query: z.object({ cursor: z.string().max(200).optional() }) },
    responses: {
      200: json("A page", alertPageSchema),
      400: errorContent("Malformed cursor (invalid_cursor, invalid_request)"),
    },
  }),
  "user",
);

const readAlertsRoute = defineAccess(
  createRoute({
    method: "post",
    path: "/me/alerts/read",
    summary: "Mark her alerts as read",
    description: "These ids (others' are ignored), or all of hers without `ids`. The first reading date stays.",
    request: body(alertReadInputSchema),
    responses: {
      200: json("How many became read", alertReadResultSchema),
      400: errorContent("Invalid body (invalid_request)"),
    },
  }),
  "user",
);

/** `user` access ran first: the session is there. */
function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

/** Read from the table, not the session: the session may be older than her account. */
async function isGuest(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isAnonymous: schema.user.isAnonymous })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row?.isAnonymous !== false;
}

const settingsColumns = {
  sizeBack: schema.alertSettings.sizeBack,
  targetPrice: schema.alertSettings.targetPrice,
  digest: schema.alertSettings.digest,
  digestHour: schema.alertSettings.digestHour,
};

const subscriptionColumns = {
  id: schema.pushSubscriptions.id,
  userAgent: schema.pushSubscriptions.userAgent,
  createdAt: schema.pushSubscriptions.createdAt,
  lastOkAt: schema.pushSubscriptions.lastOkAt,
};

const toSubscriptionView = (row: {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastOkAt: Date | null;
}): PushSubscriptionView => ({
  id: row.id,
  userAgent: row.userAgent,
  createdAt: row.createdAt.toISOString(),
  lastOkAt: row.lastOkAt?.toISOString() ?? null,
});

const cursorSchema = z.tuple([z.string(), z.string()]);

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}

/** `(created_at::text, id)` of the last alert of the previous page; throws `InvalidCursorError` when forged. */
function decodeCursor(cursor: string): [string, string] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) throw new InvalidCursorError();
  const [at, id] = result.data;
  if (!validKeyValue("timestamptz", at) || !validKeyValue("uuid", id)) throw new InvalidCursorError();
  return [at, id];
}

const isItemKind = (kind: AlertKind) => (ITEM_ALERT_KINDS as readonly AlertKind[]).includes(kind);

/** One page of « Nouvelles »: her alerts only, of the last ALERTS_DAYS days, newest first. */
export async function listAlerts(db: Database, userId: string, cursor: string | undefined, now: Date) {
  const since = new Date(now.getTime() - ALERTS_DAYS * 86_400_000);
  const e = schema.alertEvents;
  const conditions: SQL[] = [eq(e.userId, userId), gte(e.createdAt, since)];
  if (cursor) {
    const [at, id] = decodeCursor(cursor);
    conditions.push(sql`(${e.createdAt}, ${e.id}) < (cast(${at} as timestamptz), cast(${id} as uuid))`);
  }
  const rows = await db
    .select({
      id: e.id,
      kind: e.kind,
      itemId: e.itemId,
      productId: schema.items.productId,
      sizeLabel: e.sizeLabel,
      priceCents: e.priceCents,
      previousCents: e.previousCents,
      createdAt: e.createdAt,
      createdKey: sql<string>`(${e.createdAt})::text`,
      readAt: e.readAt,
      // Her item only (never another person's), in its profile of now.
      itemProfileId: schema.items.profileId,
      itemName: sql<string | null>`coalesce(${schema.items.nameOverride}, ${schema.products.name})`,
      coverMediaId: schema.items.coverMediaId,
      targetPriceCents: schema.items.targetPriceCents,
      currency: schema.products.currency,
      productImageId: sql<string | null>`(select pi.id from ${schema.productImages} pi
        where pi.product_id = ${schema.products.id} order by pi.position, pi.id limit 1)`,
      shopName: sql<string | null>`coalesce(${schema.shops.name}, item_shop.name)`,
      salePeriodName: schema.salePeriods.name,
      startsOn: schema.salePeriods.startsOn,
    })
    .from(e)
    .leftJoin(schema.items, and(eq(schema.items.id, e.itemId), eq(schema.items.userId, e.userId)))
    // Through her item only: an event never tells about a product that is not one of hers.
    .leftJoin(schema.products, eq(schema.products.id, schema.items.productId))
    .leftJoin(schema.shops, eq(schema.shops.id, e.shopId))
    .leftJoin(sql`${schema.shops} as item_shop`, sql`item_shop.id = ${schema.products.shopId}`)
    .leftJoin(schema.salePeriods, eq(schema.salePeriods.id, e.salePeriodId))
    .where(and(...conditions))
    .orderBy(desc(e.createdAt), desc(e.id))
    .limit(ALERTS_PAGE_SIZE + 1);
  const page = rows.slice(0, ALERTS_PAGE_SIZE);
  const alerts: AlertEventView[] = page.map((row) => {
    const kind = row.kind as AlertKind;
    const item = isItemKind(kind);
    const href =
      item && row.productId && row.itemProfileId ? alertItemHref(row.productId, row.itemProfileId) : ALERTS_PAGE_HREF;
    const title = item
      ? (row.itemName ?? "")
      : kind === "sale_period"
        ? (row.salePeriodName ?? "")
        : (row.shopName ?? "");
    return {
      id: row.id,
      kind,
      itemId: item && row.itemProfileId ? row.itemId : null,
      title,
      shopName: row.shopName,
      sizeLabel: row.sizeLabel,
      priceCents: row.priceCents,
      previousCents: row.previousCents,
      targetPriceCents: kind === "target_price" ? row.targetPriceCents : null,
      currency: item ? ((row.currency as AlertEventView["currency"]) ?? null) : null,
      salePeriodName: row.salePeriodName,
      startsOn: row.startsOn,
      photoUrl: item
        ? row.coverMediaId
          ? privateMediaUrl(row.coverMediaId)
          : row.productImageId
            ? catalogImageUrl(row.productImageId)
            : null
        : null,
      href,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    };
  });
  const last = page.at(-1);
  const nextCursor = rows.length > ALERTS_PAGE_SIZE && last ? encodeCursor(last.createdKey, last.id) : null;
  return { alerts, nextCursor } satisfies AlertPage;
}

export function alertsRoutes(deps: WardrobeDeps, push: PushDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  const readSettings = async (userId: string): Promise<AlertSettings> => {
    const [row] = await db
      .select(settingsColumns)
      .from(schema.alertSettings)
      .where(eq(schema.alertSettings.userId, userId));
    return row ?? DEFAULT_ALERT_SETTINGS;
  };

  return app
    .openapi(keyRoute, async (c) =>
      push.publicKey ? c.json({ publicKey: push.publicKey }, 200) : c.json(notFound, 404),
    )
    .openapi(listSubscriptionsRoute, async (c) => {
      const rows = await db
        .select(subscriptionColumns)
        .from(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.userId, userIdOf(c)))
        .orderBy(desc(schema.pushSubscriptions.createdAt), desc(schema.pushSubscriptions.id));
      return c.json({ subscriptions: rows.map(toSubscriptionView) }, 200);
    })
    .openapi(subscribeRoute, async (c) => {
      const userId = userIdOf(c);
      if (await isGuest(db, userId)) return c.json(accountRequired, 403);
      const { endpoint, keys } = c.req.valid("json");
      const userAgent = c.req.header("user-agent")?.slice(0, MAX_USER_AGENT) || null;
      // The endpoint is the browser: subscribing again (from her account or another one) takes the row over.
      const [row] = await db
        .insert(schema.pushSubscriptions)
        .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent })
        .onConflictDoUpdate({
          target: schema.pushSubscriptions.endpoint,
          set: {
            userId,
            p256dh: keys.p256dh,
            auth: keys.auth,
            userAgent,
            // Another account's device starts over as hers.
            createdAt: sql`case when ${schema.pushSubscriptions.userId} = ${userId} then ${schema.pushSubscriptions.createdAt} else now() end`,
            lastOkAt: sql`case when ${schema.pushSubscriptions.userId} = ${userId} then ${schema.pushSubscriptions.lastOkAt} else null end`,
          },
        })
        .returning(subscriptionColumns);
      if (!row) throw new Error("push subscription not written");
      return c.json(toSubscriptionView(row), 200);
    })
    .openapi(unsubscribeRoute, async (c) => {
      const removed = await db
        .delete(schema.pushSubscriptions)
        .where(
          and(
            eq(schema.pushSubscriptions.id, c.req.valid("param").id),
            eq(schema.pushSubscriptions.userId, userIdOf(c)),
          ),
        )
        .returning({ id: schema.pushSubscriptions.id });
      return removed.length > 0 ? c.body(null, 204) : c.json(notFound, 404);
    })
    .openapi(getSettingsRoute, async (c) => c.json(await readSettings(userIdOf(c)), 200))
    .openapi(patchSettingsRoute, async (c) => {
      const userId = userIdOf(c);
      if (await isGuest(db, userId)) return c.json(accountRequired, 403);
      const patch = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
      const [row] = await db
        .insert(schema.alertSettings)
        .values({ ...DEFAULT_ALERT_SETTINGS, ...patch, userId })
        .onConflictDoUpdate({ target: schema.alertSettings.userId, set: patch })
        .returning(settingsColumns);
      if (!row) throw new Error("alert settings not written");
      return c.json(row, 200);
    })
    .openapi(listAlertsRoute, async (c) => {
      try {
        return c.json(await listAlerts(db, userIdOf(c), c.req.valid("query").cursor, now()), 200);
      } catch (error) {
        if (error instanceof InvalidCursorError) return c.json(invalidCursor, 400);
        throw error;
      }
    })
    .openapi(readAlertsRoute, async (c) => {
      const { ids } = c.req.valid("json");
      const read = await db
        .update(schema.alertEvents)
        .set({ readAt: now() })
        .where(
          and(
            eq(schema.alertEvents.userId, userIdOf(c)),
            isNull(schema.alertEvents.readAt),
            ...(ids ? [inArray(schema.alertEvents.id, ids)] : []),
          ),
        )
        .returning({ id: schema.alertEvents.id });
      return c.json({ read: read.length }, 200);
    });
}
