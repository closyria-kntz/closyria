import { parisDay } from "@closyria/shared";

const DAY_MS = 86_400_000;

/** Paris calendar days from `now` to `day` (`YYYY-MM-DD`): 0 today, 1 tomorrow, -1 yesterday. */
export function daysUntil(day: string, now: Date): number {
  const today = Date.parse(`${parisDay(now)}T00:00:00Z`);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - today) / DAY_MS);
}

/**
 * The first day of the sales as she says it, from today in Paris: « aujourd'hui », « demain », « hier », the weekday
 * within the week (« mercredi »), else the date (« 7 janvier », the caller adds « le »). `started`: the day is past.
 */
export function saleDayWords(
  startsOn: string,
  now: Date,
  locale: string,
): { started: boolean; kind: "relative" | "weekday" | "date"; text: string } {
  const days = daysUntil(startsOn, now);
  const noon = new Date(`${startsOn}T12:00:00Z`);
  const started = days < 0;
  if (Math.abs(days) <= 1) {
    return {
      started,
      kind: "relative",
      text: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day"),
    };
  }
  if (days > 1 && days < 7) {
    return {
      started,
      kind: "weekday",
      text: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(noon),
    };
  }
  return {
    started,
    kind: "date",
    text: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(noon),
  };
}
