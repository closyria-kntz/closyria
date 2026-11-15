/**
 * « Réessaie dans … » of « Mes adresses d'envoi », from the API's `retryAfterSeconds`: rounded up, in minutes under an
 * hour, then in hours (the cap per address lasts a day).
 */
export type SenderWait =
  | { key: "minute" }
  | { key: "minutes"; n: number }
  | { key: "hour" }
  | { key: "hours"; n: number };

export function senderWait(seconds: number): SenderWait {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes === 1) return { key: "minute" };
  if (minutes < 60) return { key: "minutes", n: minutes };
  if (minutes === 60) return { key: "hour" };
  return { key: "hours", n: Math.ceil(minutes / 60) };
}
