/** « Corrigée »: the sheet was corrected by an admin (token colours, always with the text). */
export function CorrectedPill({ label }: { label: string }) {
  return (
    <span
      data-corrected="true"
      className="inline-flex w-fit items-center rounded-button bg-success-surface px-space-2 py-space-1 text-sm font-strong text-success"
    >
      {label}
    </span>
  );
}
