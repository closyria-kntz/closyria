import { type Database, eq, schema, sql } from "@closyria/db";
import {
  CATALOGUE_SHEET_FRESH_MS,
  CATALOGUE_SHEET_FRESH_SLOWED_MS,
  CATALOGUE_SHEET_REFRESHES_PER_MINUTE,
} from "@closyria/shared";
import type { CaptureQueue } from "./capture-queue";
import { shopInCatalogue } from "./catalogue";

const MINUTE_MS = 60_000;

export type SheetRefresh = {
  /** A fresh read is under way (or being asked): the sheet reads itself again in a few seconds. */
  refreshing: boolean;
  /** The asking itself, never awaited by the sheet (never rejects; failures are logged). Tests wait on it. */
  done: Promise<void>;
};

const nothing: SheetRefresh = { refreshing: false, done: Promise.resolve() };

type Decision = {
  id: string;
  shop_id: string;
  url: string;
  platform: string;
  last_captured_at: Date | string | null;
  slowdown: string | null;
  active: boolean;
  last_refresh_at: Date | string | null;
  recent_refreshes: number;
};

const time = (value: Date | string | null) => (value === null ? null : new Date(value).getTime());

/**
 * « Stocks frais », the live check of an open catalogue sheet. `checkedAt` is what the sheet already holds: read less
 * than 15 min ago, nothing is asked and nothing more is queried. Otherwise one query decides, and the asking (a
 * `refresh` capture on its own queue, nobody's: no « Derniers liens », no limit of hers) goes on without the sheet
 * waiting for it. Nothing is asked:
 * - for an article out of the catalogue (hidden, removed, shop not published or merged) or a shop captured by hand;
 * - for a Shopify shop while Shopify asks for the nightly rhythm; while it asks to slow down (`doubled`), only when
 *   the article was read over 60 min ago;
 * - when one is under way (then `refreshing` is still true) or one was asked within that window (even a failed one);
 * - past 10 refreshes asked in the last minute, every article together.
 * Then the sheet shows the age it has, `refreshing: false`.
 */
export async function requestSheetRefresh(
  db: Database,
  queue: CaptureQueue,
  productId: string,
  checkedAt: Date | null,
  now: Date,
): Promise<SheetRefresh> {
  if (checkedAt && now.getTime() - checkedAt.getTime() < CATALOGUE_SHEET_FRESH_MS) return nothing;
  const lastMinute = new Date(now.getTime() - MINUTE_MS).toISOString();
  const at = now.toISOString();
  const { rows } = await db.execute<Decision>(sql`
    select p.id, p.shop_id, p.canonical_url as url, s.platform, p.last_captured_at,
      (select level from crawl_slowdowns where platform = 'shopify' and until > ${at}::timestamptz) as slowdown,
      exists (select 1 from captures c where c.product_id = p.id and c.status in ('queued', 'running')) as active,
      (select max(c.created_at) from captures c where c.product_id = p.id and c.trigger = 'refresh') as last_refresh_at,
      (select count(*)::int from captures c
        where c.trigger = 'refresh' and c.created_at > ${lastMinute}::timestamptz) as recent_refreshes
    from products p join shops s on s.id = p.shop_id
    where p.id = ${productId} and p.hidden_at is null and p.removed_at is null
      and ${shopInCatalogue} and s.capture_mode = 'auto'`);
  const row = rows[0];
  if (!row) return nothing;
  const shopify = row.platform === "shopify";
  if (shopify && row.slowdown === "nightly") return nothing;
  const windowMs = shopify && row.slowdown === "doubled" ? CATALOGUE_SHEET_FRESH_SLOWED_MS : CATALOGUE_SHEET_FRESH_MS;
  const since = now.getTime() - windowMs;
  const read = time(row.last_captured_at);
  if (read !== null && read > since) return nothing;
  if (row.active) return { refreshing: true, done: Promise.resolve() };
  const asked = time(row.last_refresh_at);
  if (asked !== null && asked >= since) return nothing;
  if (row.recent_refreshes >= CATALOGUE_SHEET_REFRESHES_PER_MINUTE) return nothing;
  const done = askRefresh(db, queue, row, new Date(since), now).catch((error) => {
    console.error(`sheet refresh ${productId}: cannot ask it`, error);
  });
  return { refreshing: true, done };
}

/**
 * Creates the `refresh` capture and hands it to the worker. Under one lock for every refresh: the per-article rules
 * and the budget of the minute are checked again, so two sheets opened together never ask twice nor overrun it.
 */
async function askRefresh(
  db: Database,
  queue: CaptureQueue,
  product: Pick<Decision, "id" | "shop_id" | "url">,
  windowStart: Date,
  now: Date,
): Promise<void> {
  const lastMinute = new Date(now.getTime() - MINUTE_MS).toISOString();
  const captureId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('catalogue-sheet-refresh', 0))`);
    const { rows } = await tx.execute<{ blocked: boolean }>(sql`
      select exists (
        select 1 from captures c where c.product_id = ${product.id}
          and (c.status in ('queued', 'running')
            or (c.trigger = 'refresh' and c.created_at >= ${windowStart.toISOString()}::timestamptz))
      ) or (select count(*) from captures c
        where c.trigger = 'refresh' and c.created_at > ${lastMinute}::timestamptz) >= ${CATALOGUE_SHEET_REFRESHES_PER_MINUTE}
      as blocked`);
    if (rows[0]?.blocked) return null;
    const [capture] = await tx
      .insert(schema.captures)
      .values({
        productId: product.id,
        shopId: product.shop_id,
        url: product.url,
        trigger: "refresh",
        requestedBy: null,
        status: "queued",
        createdAt: now,
      })
      .returning({ id: schema.captures.id });
    return capture?.id ?? null;
  });
  if (!captureId) return;
  try {
    if (await queue.refreshProduct(product.id, captureId)) return;
    // Already sent in this 15-minute window: nothing will run this row.
    await db.delete(schema.captures).where(eq(schema.captures.id, captureId));
  } catch (error) {
    console.error(`sheet refresh ${product.id}: cannot queue it`, error);
    await db
      .update(schema.captures)
      .set({ status: "failed", errorCode: "queue_unavailable", finishedAt: now })
      .where(eq(schema.captures.id, captureId));
  }
}
