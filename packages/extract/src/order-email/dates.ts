const MONTHS: Record<string, number> = {
  jan: 1,
  janv: 1,
  janvier: 1,
  january: 1,
  feb: 2,
  fev: 2,
  fevr: 2,
  fevrier: 2,
  february: 2,
  mar: 3,
  mars: 3,
  march: 3,
  apr: 4,
  avr: 4,
  avril: 4,
  april: 4,
  may: 5,
  mai: 5,
  jun: 6,
  juin: 6,
  june: 6,
  jul: 7,
  juil: 7,
  juillet: 7,
  july: 7,
  aug: 8,
  aou: 8,
  aout: 8,
  august: 8,
  sep: 9,
  sept: 9,
  septembre: 9,
  september: 9,
  oct: 10,
  octobre: 10,
  october: 10,
  nov: 11,
  novembre: 11,
  november: 11,
  dec: 12,
  decembre: 12,
  december: 12,
};

const monthOf = (word: string) => MONTHS[word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\.$/, "")];

const parisFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Paris",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});

/** Paris's offset from UTC at `at`, in milliseconds. */
function parisOffset(at: number): number {
  const p = Object.fromEntries(parisFormat.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - at;
}

/** The instant of a Paris wall-clock time. */
function parisTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wall - parisOffset(wall);
  return new Date(wall - parisOffset(guess));
}

const valid = (y: number, m: number | undefined, d: number, h: number, min: number) =>
  m !== undefined && y >= 2000 && y <= 2100 && d >= 1 && d <= 31 && h <= 23 && min <= 59;

/**
 * The date of a forwarded e-mail's header, as mail programs write it: RFC 5322 with its zone (« Mon, 9 Nov 2026
 * 14:32:00 +0100 »), Gmail in English (« Mon, Nov 9, 2026 at 2:32 PM ») or French (« lun. 9 nov. 2026 à 14:32 »),
 * Outlook (« samedi 7 novembre 2026 16:20 »). Without a zone, the time is read in Paris; null when unreadable.
 */
export function parseHeaderDate(value: string): Date | null {
  const text = value.trim();
  if (/[+-]\d{4}\b|\b(?:GMT|UTC)\b/.test(text) && /\d{1,2}:\d{2}/.test(text)) {
    const at = Date.parse(text.replace(/\s+(?:at|à)\s+/i, " "));
    if (Number.isFinite(at)) return new Date(at);
  }
  // « 9 nov. 2026 à 14:32 », « 7 novembre 2026 16:20 ».
  const dayFirst = /(\d{1,2})\s+([\p{L}.]{3,10})\s+(\d{4})(?:[\s,]+(?:à\s+)?(\d{1,2})[:h](\d{2}))?/u.exec(text);
  if (dayFirst) {
    const [, d, word = "", y, h = "0", min = "0"] = dayFirst;
    const month = monthOf(word);
    if (valid(Number(y), month, Number(d), Number(h), Number(min))) {
      return parisTime(Number(y), month as number, Number(d), Number(h), Number(min));
    }
  }
  // « Nov 9, 2026 at 2:32 PM ».
  const monthFirst = /([\p{L}.]{3,10})\s+(\d{1,2}),?\s+(\d{4})(?:[\s,]+(?:at\s+)?(\d{1,2}):(\d{2})\s*([AP]M)?)?/iu.exec(
    text,
  );
  if (monthFirst) {
    const [, word = "", d, y, h = "0", min = "0", half] = monthFirst;
    let hour = Number(h);
    if (half?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (half?.toUpperCase() === "AM" && hour === 12) hour = 0;
    const month = monthOf(word);
    if (valid(Number(y), month, Number(d), hour, Number(min))) {
      return parisTime(Number(y), month as number, Number(d), hour, Number(min));
    }
  }
  return null;
}
