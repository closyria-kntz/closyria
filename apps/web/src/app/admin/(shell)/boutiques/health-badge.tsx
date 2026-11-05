import type { ShopHealth } from "@closyria/shared";

const tone: Record<ShopHealth, string> = {
  ok: "bg-success-surface text-success",
  degraded: "bg-premium-surface text-premium",
  down: "bg-surface-sunken text-danger",
  not_applicable: "bg-surface-sunken text-ink-muted",
};

/** The health of a shop: a token colour and always the text, never the colour alone. */
export function HealthBadge({ health, label }: { health: ShopHealth; label: string }) {
  return (
    <span
      data-health={health}
      className={`inline-flex items-center rounded-button px-space-2 py-space-1 text-sm font-strong ${tone[health]}`}
    >
      {label}
    </span>
  );
}
