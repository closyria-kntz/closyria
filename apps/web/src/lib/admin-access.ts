import type { AdminSession } from "@closyria/shared";

export type AdminAccess = "ok" | "not-found" | "passkey-required";

/**
 * Who may see the admin area (spec §8, ruling R15). Without a session or without the admin role the area
 * does not exist (404, its existence is not revealed). An admin who did not sign in with a passkey is sent
 * to the page explaining how to use one. The API enforces the same rule on every admin route.
 */
export function adminAccess(session: AdminSession): AdminAccess {
  if (session?.user.role !== "admin") return "not-found";
  return session.session.authMethod === "passkey" ? "ok" : "passkey-required";
}

/**
 * The access decision from a session loader. If the session cannot be checked (API down, timeout, bad
 * answer), the area does not exist for this request: 404, never a 500 that would reveal it. Only the
 * error class is logged, never its message (it could carry personal data).
 */
export async function loadAdminAccess(load: () => Promise<AdminSession>): Promise<AdminAccess> {
  try {
    return adminAccess(await load());
  } catch (error) {
    const kind = error instanceof Error ? error.name : typeof error;
    console.error(JSON.stringify({ event: "admin.session_check_failed", error: kind }));
    return "not-found";
  }
}
