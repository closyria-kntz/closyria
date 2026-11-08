const token = (name: string): string => window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** How long the flight lasts: the `--motion-duration-fly` token (0 under reduced motion), read when it starts. */
function flyDuration(): number {
  const raw = token("--motion-duration-fly");
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return 0;
  return raw.endsWith("ms") ? value : value * 1000;
}

/**
 * A small photo shape (shape C) of `color` (a CSS colour or `var(--token)`) flies from `from` to `to` and disappears. Decorative: it
 * resolves at once under reduced motion (nothing is created), never throws, and always removes its element.
 */
export async function flyTo(from: Element, to: Element, color: string): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const duration = flyDuration();
  if (duration <= 0) return;
  const shape = document.createElement("span");
  try {
    shape.className = "fly-photo";
    shape.style.setProperty("--fly-color", color);
    document.body.appendChild(shape);
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    // The shape is as wide as its CSS says (it starts at the top left corner): centre it on the card, then on the band.
    const startX = a.left + a.width / 2;
    const startY = a.top + a.height / 2;
    const dx = b.left + b.width / 2 - startX;
    const dy = b.top + b.height / 2 - startY;
    const at = (x: number, y: number, scale: number) =>
      `translate(${startX + x}px, ${startY + y}px) translate(-50%, -50%) scale(${scale})`;
    const flight = shape.animate(
      [
        { transform: at(0, 0, 1), opacity: 1 },
        { transform: at(dx / 2, dy / 2 - Math.abs(dy) / 4, 0.75), opacity: 1, offset: 0.5 },
        { transform: at(dx, dy, 0.2), opacity: 0.4 },
      ],
      { duration, easing: token("--ease-emphasized") },
    );
    await flight.finished;
  } catch {
    // Decorative: a failed flight is no failure.
  } finally {
    shape.remove();
  }
}
