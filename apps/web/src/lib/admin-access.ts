import type { AdminSession } from "@closyria/shared";
import { SessionCheckError } from "./admin-api";

/** A failed session check is tried once more after this long (a slow or busy API recovers in a moment). */
export const SESSION_RETRY_MS = 300;

/** Worth a second try: a 5xx, a network error or a timeout. Never a 401/403 or any other answer, nor a bad body. */
function isTransient(error: unknown): boolean {
  if (error instanceof SessionCheckError) return error.status >= 500;
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError)
  );
}

export type AdminAccess = "ok" | "not-found" | "passkey-required" | "sign-in";

/**
 * Who may see the admin area (spec §8, ruling R15, comptes visibles 2026-11-14). A visitor who is not signed in to
 * an account (no session, or a guest's anonymous one) is sent to the sign-in page, as on any site. A signed-in account
 * without the admin role finds nothing (404, its existence is not revealed). An admin who did not sign in with a
 * passkey is sent to the page explaining how to use one. The API enforces the same rule on every admin route.
 */
export function adminAccess(session: AdminSession): AdminAccess {
  if (!session) return "sign-in";
  if (session.user.role !== "admin") return session.session.authMethod === "anonymous" ? "sign-in" : "not-found";
  return session.session.authMethod === "passkey" ? "ok" : "passkey-required";
}

/**
 * The access decision from a session loader. If the session cannot be checked (API down, timeout, bad
 * answer), the area does not exist for this request: 404, never a 500 that would reveal it. Once more after a 5xx, a network error or a timeout. Only the
 * error class (and the HTTP status of a refusal) is logged, never its message (it could carry personal data).
 */
export async function loadAdminAccess(
  load: () => Promise<AdminSession>,
  retryMs: number = SESSION_RETRY_MS,
): Promise<AdminAccess> {
  try {
    try {
      return adminAccess(await load());
    } catch (error) {
      if (!isTransient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      return adminAccess(await load());
    }
  } catch (error) {
    const kind = error instanceof Error ? error.name : typeof error;
    console.error(
      JSON.stringify({
        event: "admin.session_check_failed",
        error: kind,
        ...(error instanceof SessionCheckError ? { status: error.status } : {}),
      }),
    );
    return "not-found";
  }
}
