import type { SalePeriod } from "@closyria/shared";

export type Draft = { name: string; startsOn: string; endsOn: string };
export const EMPTY_DRAFT: Draft = { name: "", startsOn: "", endsOn: "" };

export type Phase = "current" | "upcoming" | "past";

/** Where a period stands on `today` (Paris day, `YYYY-MM-DD`): the days compare as strings. */
export function periodPhase(period: Pick<SalePeriod, "startsOn" | "endsOn">, today: string): Phase {
  if (period.endsOn < today) return "past";
  return period.startsOn > today ? "upcoming" : "current";
}

/** What the form refuses before sending (the API refuses the same): the message key, or null when it may go. */
export function draftError(draft: Draft): "invalidName" | "invalidDates" | "endBeforeStart" | null {
  if (draft.name.trim() === "") return "invalidName";
  if (draft.startsOn === "" || draft.endsOn === "") return "invalidDates";
  return draft.endsOn < draft.startsOn ? "endBeforeStart" : null;
}
