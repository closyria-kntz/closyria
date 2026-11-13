import { focusRing } from "@/components/ui";

export { buttonClass, focusRing, inputClass, primaryButtonClass } from "@/components/ui";

/** A written link of a list row or a sheet (« Voir la fiche », « Voir chez … »): a finger high (44 px), underlined. */
export const sheetLinkClass = `inline-flex min-h-touch-target items-center font-strong text-ink underline underline-offset-4 ${focusRing}`;
