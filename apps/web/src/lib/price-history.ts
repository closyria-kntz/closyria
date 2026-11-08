import type { PriceHistory } from "@closyria/shared";

const DAY_MS = 86_400_000;
/** « le plus bas depuis {n} mois » only from a month of hindsight, in whole months (rounded down). */
const MONTH_DAYS = 30;

/** When the drop started, as the sentence says it: « aujourd’hui », « hier », « mardi » (this week), « le 3 octobre ». */
export type DropSince = { kind: "today" | "yesterday" | "weekday" | "date"; date: Date };

/**
 * The one drop line of the sheet, « −{x} € depuis {jour}, le plus bas depuis {n} mois »: only for a real drop
 * (`dropCents` < 0); `months` only from 30 days of hindsight (never an all-time low). `dropSince` is a UTC date.
 */
export function dropMention(
  history: PriceHistory,
  now: Date,
): { cents: number; since: DropSince; months: number | null } | null {
  if (history.dropCents === null || history.dropCents >= 0 || history.dropSince === null) return null;
  const date = new Date(`${history.dropSince}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const days = Math.round((today - date.getTime()) / DAY_MS);
  const kind = days <= 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? "weekday" : "date";
  const lowest = history.lowestSinceDays;
  return {
    cents: -history.dropCents,
    since: { kind, date },
    months: lowest !== null && lowest >= MONTH_DAYS ? Math.floor(lowest / MONTH_DAYS) : null,
  };
}

/**
 * The curve's polyline in a `width` × `height` box (SVG units, y downwards): points spread on their dates, the
 * lowest price at the bottom, a flat price in the middle; a margin keeps the end dot inside. Null under two points.
 */
export function curveGeometry(
  points: PriceHistory["points"],
  width: number,
  height: number,
): { points: string; end: { x: number; y: number } } | null {
  if (points.length < 2) return null;
  const margin = Math.min(6, height / 4);
  const times = points.map((point) => Date.parse(point.at));
  const prices = points.map((point) => point.priceCents);
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const [low, high] = [Math.min(...prices), Math.max(...prices)];
  const round = (n: number) => Math.round(n * 10) / 10;
  const xy = points.map((point, index) => {
    const x = t1 === t0 ? index / (points.length - 1) : ((times[index] as number) - t0) / (t1 - t0);
    const y = high === low ? 0.5 : (high - point.priceCents) / (high - low);
    return { x: round(margin + x * (width - 2 * margin)), y: round(margin + y * (height - 2 * margin)) };
  });
  const end = xy.at(-1) as { x: number; y: number };
  return { points: xy.map(({ x, y }) => `${x},${y}`).join(" "), end };
}
