import { GUEST_DELETE_CONFIRMATION } from "@closyria/shared";

export type UserDeleteErrorKey = "mismatch" | "self" | "admin" | "notFound" | "generic";

/** The message (under `Admin.users.delete`) for a refused « Supprimer ce compte ». */
export function userDeleteErrorKey(status: number, body: unknown): UserDeleteErrorKey {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  if (status === 400 && error === "confirmation_mismatch") return "mismatch";
  if (status === 409 && error === "self") return "self";
  if (status === 409 && error === "admin") return "admin";
  if (status === 404) return "notFound";
  return "generic";
}

/** What the admin must type: her e-mail (any case), or « SUPPRIMER » for a guest (the API checks it again). */
export function deleteConfirmed(typed: string, email: string | null): boolean {
  const value = typed.trim();
  return email === null ? value === GUEST_DELETE_CONFIRMATION : value.toLowerCase() === email.toLowerCase();
}
