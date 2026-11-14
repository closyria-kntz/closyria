import { type AdminProductDetail, type AdminProductPublishedAt, adminProductPublishedAtSchema } from "@closyria/shared";

type Sheet = Pick<AdminProductDetail, "publishedAt" | "publishedSource">;

/** The day the « Date de mise en ligne » field shows for a sheet (`YYYY-MM-DD` in UTC, empty when unknown). */
export function publishedDay(sheet: Sheet): string {
  return sheet.publishedAt ? sheet.publishedAt.slice(0, 10) : "";
}

/**
 * What saving the field does: nothing when the day shown is unchanged (an automatic date is never turned into the
 * admin's by a mere save); an empty field clears only a date set by hand (`admin`); otherwise the day, checked like
 * the API checks it.
 */
export function publishedAtSave(
  day: string,
  sheet: Sheet,
): { kind: "unchanged" } | { kind: "invalid" } | { kind: "send"; body: AdminProductPublishedAt } {
  if (day === publishedDay(sheet)) return { kind: "unchanged" };
  if (day === "") {
    return sheet.publishedSource === "admin" ? { kind: "send", body: { publishedAt: null } } : { kind: "invalid" };
  }
  const body = adminProductPublishedAtSchema.safeParse({ publishedAt: day });
  return body.success ? { kind: "send", body: body.data } : { kind: "invalid" };
}
