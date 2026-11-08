/** The check mark; `draw` strokes it once (the « chip-check » animation, none under reduced motion). */
export function Tick({ draw = false }: { draw?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-space-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path
        d="M3.5 8.5l3 3 6-7"
        pathLength={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={draw ? "chip-check" : ""}
      />
    </svg>
  );
}
