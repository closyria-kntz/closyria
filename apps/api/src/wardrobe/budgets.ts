import { type Database, schema, sql } from "@closyria/db";
import type { BudgetPeriod, BudgetView } from "@closyria/shared";
import type { Tx } from "./events";

/** What the periods need of a budget row. `startsOn`/`endsOn`: `YYYY-MM-DD`, `custom` only. */
export type PeriodBudget = {
  period: BudgetPeriod | string;
  startsOn: string | null;
  endsOn: string | null;
  resetAt: Date | null;
  createdAt: Date;
};
export type Period = { start: Date; end: Date };
export type BudgetScope = { profileId: string } | { wishlistId: string };

/** End of a `none` period: it never ends. */
export const FAR_FUTURE = new Date(Date.UTC(9999, 11, 31));
const WEEKS_OF_HISTORY = 8;
const MONTHS_OF_HISTORY = 12;
const TIME_ZONE = "Europe/Paris";

const parisParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** The calendar date and time in Paris at `instant`, as numbers (month 1–12). */
function inParis(instant: Date) {
  const parts: Record<string, number> = {};
  for (const p of parisParts.formatToParts(instant)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Offset of Paris from UTC at `instant`, in ms (+1 h in winter, +2 h in summer). */
function parisOffsetMs(instant: Date): number {
  const p = inParis(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * 00:00 in Paris on that calendar day; `month` and `day` may overflow (Date.UTC normalises them).
 * Midnight is never inside a daylight-time jump in Paris (they happen at 2 or 3 a.m.), so it always exists once.
 */
function parisMidnight(year: number, month: number, day: number): Date {
  const wall = Date.UTC(year, month - 1, day);
  const guess = new Date(wall - parisOffsetMs(new Date(wall)));
  return new Date(wall - parisOffsetMs(guess));
}

function parseDate(value: string): { year: number; month: number; day: number } {
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  return { year, month, day };
}

/** Monday 00:00 in Paris of the week holding `instant`, shifted by `weeks`. */
function weekAt(instant: Date, weeks = 0): Period {
  const p = inParis(instant);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 Sunday
  const monday = p.day - ((weekday + 6) % 7) + weeks * 7;
  return { start: parisMidnight(p.year, p.month, monday), end: parisMidnight(p.year, p.month, monday + 7) };
}

/** 1st 00:00 in Paris of the month holding `instant`, shifted by `months`. */
function monthAt(instant: Date, months = 0): Period {
  const p = inParis(instant);
  return { start: parisMidnight(p.year, p.month + months, 1), end: parisMidnight(p.year, p.month + months + 1, 1) };
}

/**
 * The period of the budget holding `now`, end exclusive (Europe/Paris): the week from Monday 00:00, the month from
 * the 1st 00:00, `custom` from `startsOn` 00:00 to the day after `endsOn` 00:00 (also before it begins), `none` from
 * the last reset (else the creation) to FAR_FUTURE. Null once a `custom` budget has ended.
 */
export function periodAt(budget: PeriodBudget, now: Date): Period | null {
  switch (budget.period) {
    case "week":
      return weekAt(now);
    case "month":
      return monthAt(now);
    case "custom": {
      if (!budget.startsOn || !budget.endsOn) return null;
      const from = parseDate(budget.startsOn);
      const to = parseDate(budget.endsOn);
      const period = {
        start: parisMidnight(from.year, from.month, from.day),
        end: parisMidnight(to.year, to.month, to.day + 1),
      };
      return now.getTime() < period.end.getTime() ? period : null;
    }
    default:
      return { start: budget.resetAt ?? budget.createdAt, end: FAR_FUTURE };
  }
}

/**
 * The complete periods before the current one, newest first: 8 weeks or 12 months, never one that ends before the
 * budget was created (its creation week or month is the oldest). `custom` and `none`: none.
 */
export function previousPeriods(budget: PeriodBudget, now: Date): Period[] {
  const step = budget.period === "week" ? weekAt : budget.period === "month" ? monthAt : null;
  if (!step) return [];
  const count = budget.period === "week" ? WEEKS_OF_HISTORY : MONTHS_OF_HISTORY;
  const periods: Period[] = [];
  for (let k = 1; k <= count; k++) {
    const period = step(now, -k);
    if (period.end.getTime() <= budget.createdAt.getTime()) break;
    periods.push(period);
  }
  return periods;
}

/**
 * « Déjà commandé » between `start` (inclusive) and `end` (exclusive): what the stage events `ordered` counted
 * (`spent_cents`) minus what the `returned` ones gave back, by their date `at`, never below 0. Undone changes left no
 * event. Profile: the items now in it; list: the items in it. Trashed items still count (they were ordered).
 */
export async function spentInPeriod(db: Database | Tx, scope: BudgetScope, start: Date, end: Date): Promise<number> {
  const inScope =
    "profileId" in scope
      ? sql`i.profile_id = ${scope.profileId}`
      : sql`exists (select 1 from ${schema.wishlistItems} wi where wi.item_id = i.id and wi.wishlist_id = ${scope.wishlistId})`;
  const result = await db.execute<{ spent: string | null }>(sql`
    select sum(case when e.stage = 'ordered' then coalesce(e.spent_cents, 0) else -coalesce(e.spent_cents, 0) end)
      as spent
    from ${schema.itemEvents} e
    join ${schema.items} i on i.id = e.item_id
    where e.type = 'stage' and e.stage in ('ordered', 'returned')
      and e.at >= ${start.toISOString()} and e.at < ${end.toISOString()}
      and ${inScope}`);
  return Math.max(0, Number(result.rows[0]?.spent ?? 0));
}

type BudgetRow = PeriodBudget & { amountCents: number };

/** The budget as the API shows it, with what is already ordered in its current period. */
export async function budgetView(
  db: Database | Tx,
  scope: BudgetScope,
  budget: BudgetRow,
  now: Date,
): Promise<BudgetView> {
  const period = periodAt(budget, now);
  const spentCents = period ? await spentInPeriod(db, scope, period.start, period.end) : 0;
  return {
    amountCents: budget.amountCents,
    period: budget.period as BudgetPeriod,
    startsOn: budget.startsOn,
    endsOn: budget.endsOn,
    current: period && {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      spentCents,
      remainingCents: budget.amountCents - spentCents,
    },
    ended: period === null,
  };
}

/** The past periods with what was ordered in each, at the budget's current amount. */
export async function budgetHistory(db: Database | Tx, scope: BudgetScope, budget: BudgetRow, now: Date) {
  const periods = [];
  for (const period of previousPeriods(budget, now)) {
    periods.push({
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      spentCents: await spentInPeriod(db, scope, period.start, period.end),
      amountCents: budget.amountCents,
    });
  }
  return { periods };
}
