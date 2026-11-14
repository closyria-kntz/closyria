/**
 * Better Auth's session cookie (default name; `__Secure-` in front over https). The web server only checks whether it
 * is there, never what it holds: a hint for the first paint, the session itself is read by the API.
 */
export const SESSION_COOKIE_NAMES = ["better-auth.session_token", "__Secure-better-auth.session_token"] as const;

/** True when the request carries a session cookie (valid or not: the summary read decides). */
export function hasSessionCookie(has: (name: string) => boolean): boolean {
  return SESSION_COOKIE_NAMES.some((name) => has(name));
}

/**
 * The band's first state (comptes visibles 2026-11-14): no session cookie means a guest for sure, so « Se connecter »
 * shows from the first paint; with one, unknown (null) until the summary says guest or account.
 */
export function initialGuest(hasSession: boolean): boolean | null {
  return hasSession ? null : true;
}
