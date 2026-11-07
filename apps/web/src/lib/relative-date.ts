const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Days between the local calendar days of two instants (1 = yesterday). */
function calendarDays(then: Date, now: Date): number {
  const start = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((end - start) / DAY);
}

/**
 * When an opinion was given, as a friend reads it: « à l'instant », « il y a 5 min », « il y a 2 h », « hier »,
 * « il y a 3 jours », then the date (« 2 novembre », with the year when it is another one).
 */
export function relativeDate(iso: string, now: Date, locale: string): string {
  const then = new Date(iso);
  const elapsed = Math.max(0, now.getTime() - then.getTime());
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (elapsed < MINUTE) return rtf.format(0, "second");
  if (elapsed < HOUR) return rtf.format(-Math.floor(elapsed / MINUTE), "minute");
  const days = calendarDays(then, now);
  if (days === 0) return rtf.format(-Math.floor(elapsed / HOUR), "hour");
  if (days < 7) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
  const sameYear = then.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(then);
}
