import { eq, readAiMonthlyCapCents, schema, sql } from "@closyria/db";
import {
  ADMIN_ORDER_EMAILS_DAYS,
  AI_MONTHLY_CAP_SETTING,
  adminAiCapInputSchema,
  adminCatalogErrorSchema,
  adminOrderEmailsSchema,
  aiMonth,
  NANO_USD_PER_EURO_CENT,
} from "@closyria/shared";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { defineAccess } from "../../access";
import { type AdminEnv, noteAudit } from "../../admin-audit";
import type { AdminDeps } from "./overview";

const DAY_MS = 86_400_000;
const invalidRequest = { error: "invalid_request" } as const;

const orderEmailsRoute = defineAccess(
  createRoute({
    method: "get",
    path: "/admin/order-emails",
    summary: "« E-mails de commande »: what the order e-mails became, and the AI's month",
    description:
      `Aggregates only over the last ${ADMIN_ORDER_EMAILS_DAYS} days (spec « Après la commande » §4): never a ` +
      "sender, an address, a subject, an article or a person. An e-mail's shop is the one of the order it became " +
      "(a non-dismissed one first); a failed e-mail has one only once she typed its order by hand. An e-mail that " +
      "completed an existing order has none of its own and counts without a shop. `ai`: the Paris month's cost, in " +
      "euro cents (a dollar counted as a euro), and the cap.",
    responses: {
      200: { description: "Figures", content: { "application/json": { schema: adminOrderEmailsSchema } } },
    },
  }),
  "admin",
);

const aiCapRoute = defineAccess(
  createRoute({
    method: "put",
    path: "/admin/settings/ai-cap",
    summary: "Set the AI's monthly cap (euro cents, 0 to 1 000 €)",
    description:
      "Read by the next AI call: past the cap, an e-mail no known format reads stays « On n'a pas su lire ».",
    request: {
      body: { required: true, content: { "application/json": { schema: adminAiCapInputSchema } } },
    },
    responses: {
      200: { description: "The cap kept", content: { "application/json": { schema: adminAiCapInputSchema } } },
      400: {
        description: "Not a whole number of cents from 0 to 100 000",
        content: { "application/json": { schema: adminCatalogErrorSchema } },
      },
    },
  }),
  "admin",
);

/** Admin « E-mails de commande » (spec §4) and the AI cap it shows. */
export function adminOrderEmailsRoutes(deps: AdminDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  return app
    .openapi(orderEmailsRoute, async (c) => {
      const at = now();
      const since = new Date(at.getTime() - ADMIN_ORDER_EMAILS_DAYS * DAY_MS).toISOString();
      const month = aiMonth(at);
      // Each e-mail with the order it became: a non-dismissed one first, the latest. Only ids, statuses and shops
      // leave the database: never the sender, the inbox or the lines.
      const mails = sql`
        select e.status, o.shop_id, o.status as order_status, o.parse_method
        from inbound_emails e
        left join lateral (
          select shop_id, status, parse_method from orders
          where inbound_email_id = e.id
          order by (status = 'dismissed'), created_at desc
          limit 1
        ) o on true
        where e.received_at >= ${since}::timestamptz`;
      const [totals, perShop, [usage], capCents] = await Promise.all([
        db.execute<{
          received: number;
          ignored: number;
          queued: number;
          parsed: number;
          failed: number;
          known: number;
          ai: number;
        }>(sql`
          select
            count(*)::int as received,
            (count(*) filter (where status = 'ignored'))::int as ignored,
            (count(*) filter (where status = 'queued'))::int as queued,
            (count(*) filter (where status = 'parsed'))::int as parsed,
            (count(*) filter (where status = 'failed'))::int as failed,
            (count(*) filter (where status = 'parsed' and parse_method = 'known'))::int as known,
            (count(*) filter (where status = 'parsed' and parse_method = 'ai'))::int as ai
          from (${mails}) m`),
        db.execute<{ shop_id: string | null; name: string | null; parsed: number; failed: number; dismissed: number }>(
          sql`
          select m.shop_id, s.name,
            (count(*) filter (where m.status = 'parsed'))::int as parsed,
            (count(*) filter (where m.status = 'failed'))::int as failed,
            (count(*) filter (where m.status = 'parsed' and m.order_status = 'dismissed'))::int as dismissed
          from (${mails}) m
          left join shops s on s.id = m.shop_id
          where m.status in ('parsed', 'failed')
          group by m.shop_id, s.name
          order by count(*) desc, s.name asc nulls last, m.shop_id`,
        ),
        db
          .select({ cost: schema.aiUsageMonths.costNanoUsd, calls: schema.aiUsageMonths.calls })
          .from(schema.aiUsageMonths)
          .where(eq(schema.aiUsageMonths.month, month)),
        readAiMonthlyCapCents(db),
      ]);
      const [total] = totals.rows;
      return c.json(
        {
          days: ADMIN_ORDER_EMAILS_DAYS,
          counts: {
            received: total?.received ?? 0,
            ignored: total?.ignored ?? 0,
            queued: total?.queued ?? 0,
            parsed: total?.parsed ?? 0,
            failed: total?.failed ?? 0,
          },
          byMethod: { known: total?.known ?? 0, ai: total?.ai ?? 0 },
          shops: perShop.rows.map((row) => ({
            shopId: row.shop_id,
            name: row.name,
            parsed: row.parsed,
            failed: row.failed,
            dismissed: row.dismissed,
            readRate: row.parsed + row.failed > 0 ? row.parsed / (row.parsed + row.failed) : null,
          })),
          ai: {
            month,
            costCents: (usage?.cost ?? 0) / NANO_USD_PER_EURO_CENT,
            calls: usage?.calls ?? 0,
            capCents,
          },
        },
        200,
      );
    })
    .openapi(aiCapRoute, async (c) => {
      const { capCents } = c.req.valid("json");
      noteAudit(c, { action: "settings.ai_cap", target: `setting:${AI_MONTHLY_CAP_SETTING}`, details: { capCents } });
      await db
        .insert(schema.appSettings)
        .values({ key: AI_MONTHLY_CAP_SETTING, value: capCents })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: capCents, updatedAt: sql`now()` },
        });
      return c.json({ capCents }, 200);
    });
}
