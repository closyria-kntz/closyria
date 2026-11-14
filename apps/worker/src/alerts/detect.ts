import { and, eq, gt, inArray, isNotNull, isNull, schema, sql } from "@closyria/db";
import {
  DEFAULT_ALERT_SETTINGS,
  isRealDrop,
  nextSendAt,
  parisDay,
  type SizeKind,
  sizeCameBack,
  sizeKindsByCategory,
  watchedSizes,
} from "@closyria/shared";
import type { Transaction } from "../capture/write-product";

/** One point of a product's history: its price (null when unknown) and its stock by the shop's size label. */
export type HistoryPoint = { priceCents: number | null; sizes: Record<string, boolean> };

/** A « size back » alert is not repeated for the same item and size within this time (a blinking size counts once). */
export const SIZE_BACK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * A followed wish: still « Repéré » (not ordered or further), not in the trash, « M'alerter » on, and tied to a
 * product. The same rule for every alert (item, shop promo, sales) and for the revisits.
 */
export const followedItem = and(
  eq(schema.items.stage, "spotted"),
  isNull(schema.items.deletedAt),
  eq(schema.items.alertsEnabled, true),
  isNotNull(schema.items.productId),
);

type NewEvent = typeof schema.alertEvents.$inferInsert;

const samePoint = (a: HistoryPoint, b: HistoryPoint): boolean => {
  if (a.priceCents !== b.priceCents) return false;
  const labels = new Set([...Object.keys(a.sizes), ...Object.keys(b.sizes)]);
  for (const label of labels) if ((a.sizes[label] === true) !== (b.sizes[label] === true)) return false;
  return true;
};

/**
 * Creates the item alerts born from one change of a product (its previous history point → the new one) for every
 * person following it, each on her own item: `size_back` (a watched size back in stock) and `target_price` (the price
 * reaches her « Préviens-moi sous … € » from above) are immediate, held until 8:00 Paris at night; `price_drop` (a real
 * drop: 5 % or 5 €) goes into the Paris day's digest, unless the same fall already made a `target_price`.
 *
 * Nothing without a previous point (a first write is no change) or when nothing changed. A kind she turned off in her
 * settings is not created; the digest switch is the sender's (her drops still show in « Nouvelles »). Returns how many
 * events were created.
 */
export async function detectAlerts(
  tx: Transaction,
  productId: string,
  previous: HistoryPoint | null,
  next: HistoryPoint,
  at: Date,
): Promise<number> {
  if (!previous || samePoint(previous, next)) return 0;

  const followers = await tx
    .select({
      itemId: schema.items.id,
      userId: schema.items.userId,
      profileId: schema.items.profileId,
      sizeLabel: schema.items.sizeLabel,
      targetPriceCents: schema.items.targetPriceCents,
      categoryId: sql<string | null>`coalesce(${schema.items.categoryId}, ${schema.products.categoryId})`,
      sizesTop: schema.profiles.sizesTop,
      sizesBottom: schema.profiles.sizesBottom,
      sizesShoes: schema.profiles.sizesShoes,
      sizeBack: schema.alertSettings.sizeBack,
      targetPrice: schema.alertSettings.targetPrice,
    })
    .from(schema.items)
    .innerJoin(schema.products, eq(schema.products.id, schema.items.productId))
    // Her own profile only: the event never names someone else's.
    .innerJoin(
      schema.profiles,
      and(eq(schema.profiles.id, schema.items.profileId), eq(schema.profiles.userId, schema.items.userId)),
    )
    .leftJoin(schema.alertSettings, eq(schema.alertSettings.userId, schema.items.userId))
    .where(and(eq(schema.items.productId, productId), followedItem));
  if (followers.length === 0) return 0;

  const sizeBackOn = (f: (typeof followers)[number]) => f.sizeBack ?? DEFAULT_ALERT_SETTINGS.sizeBack;
  const sizesChanged = !samePoint({ priceCents: null, sizes: previous.sizes }, { priceCents: null, sizes: next.sizes });

  // Which of her sizes applies: the category tree is only read when a follower without a size on her item needs it.
  let kinds: Map<string, SizeKind> | undefined;
  if (sizesChanged && followers.some((f) => sizeBackOn(f) && !f.sizeLabel?.trim() && f.categoryId)) {
    kinds = sizeKindsByCategory(
      await tx
        .select({ id: schema.categories.id, parentId: schema.categories.parentId, slug: schema.categories.slug })
        .from(schema.categories),
    );
  }

  const sendAfter = nextSendAt(at);
  const digestOn = parisDay(at);
  const events: NewEvent[] = [];
  const sizeBacks: { event: NewEvent; labels: string[]; any: boolean }[] = [];
  for (const f of followers) {
    const base = { userId: f.userId, profileId: f.profileId, itemId: f.itemId, productId };
    if (sizesChanged && sizeBackOn(f)) {
      const kind = f.categoryId ? kinds?.get(f.categoryId) : undefined;
      const profileSizes =
        kind === "top" ? f.sizesTop : kind === "bottom" ? f.sizesBottom : kind === "shoes" ? f.sizesShoes : [];
      const watched = watchedSizes(f.sizeLabel, profileSizes, kind !== undefined);
      const labels = sizeCameBack(previous.sizes, next.sizes, watched);
      if (labels.length > 0) {
        sizeBacks.push({ event: { ...base, kind: "size_back", sendAfter }, labels, any: watched === "any" });
      }
    }

    const before = previous.priceCents;
    const now = next.priceCents;
    if (before === null || now === null) continue;
    const target = f.targetPriceCents;
    const targetOn = f.targetPrice ?? DEFAULT_ALERT_SETTINGS.targetPrice;
    const reached = target !== null && before > target && now <= target;
    if (reached && targetOn) {
      events.push({ ...base, kind: "target_price", priceCents: now, previousCents: before, sendAfter });
    } else if (isRealDrop(before, now)) {
      events.push({ ...base, kind: "price_drop", priceCents: now, previousCents: before, digestOn });
    }
  }

  if (sizeBacks.length > 0) {
    // Recent « size back » alerts on these items: a size that blinks (gone, back within the day) counts once.
    const recent = await tx
      .select({ itemId: schema.alertEvents.itemId, sizeLabel: schema.alertEvents.sizeLabel })
      .from(schema.alertEvents)
      .where(
        and(
          inArray(
            schema.alertEvents.itemId,
            sizeBacks.map((s) => s.event.itemId ?? ""),
          ),
          eq(schema.alertEvents.kind, "size_back"),
          gt(schema.alertEvents.createdAt, new Date(at.getTime() - SIZE_BACK_COOLDOWN_MS)),
        ),
      );
    for (const { event, labels, any } of sizeBacks) {
      const alerted = recent.filter((r) => r.itemId === event.itemId);
      // « Any size »: one alert per item; otherwise one per size, the first one back in the shop's order.
      if (any && alerted.length > 0) continue;
      const label = labels.find((l) => !alerted.some((r) => r.sizeLabel === l));
      if (label) events.push({ ...event, sizeLabel: label });
    }
  }

  if (events.length === 0) return 0;
  // The cooldown compares with `created_at`: the event is born at the change, not at the transaction's start.
  await tx.insert(schema.alertEvents).values(events.map((e) => ({ ...e, createdAt: at })));
  return events.length;
}
