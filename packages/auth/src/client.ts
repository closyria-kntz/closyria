import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient as createBetterAuthClient } from "better-auth/client";
import { anonymousClient, emailOTPClient } from "better-auth/client/plugins";

/** Browser auth client for the web app, pointing at the API's `/api/auth`. */
export function createAuthClient(baseURL: string) {
  return createBetterAuthClient({ baseURL, plugins: [anonymousClient(), emailOTPClient(), passkeyClient()] });
}

/** The part of the auth client `ensureSession` needs. */
export type SessionClient = {
  getSession(): Promise<{ data: unknown }>;
  signIn: { anonymous(): Promise<{ error: unknown }> };
};

const SESSION_LOCK = "closyria-session";

type LockManagerLike = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };

/**
 * Makes sure the browser has a session, signing in anonymously if needed.
 *
 * Two tabs opened at once on a first visit both have no cookie, so the server cannot tell
 * them apart: the Web Locks API serialises them across tabs, and the session is checked
 * again inside the lock so the second tab reuses the cookie the first one received.
 */
export async function ensureSession(client: SessionClient): Promise<void> {
  const run = async () => {
    const { data } = await client.getSession();
    if (data) return;
    const { error } = await client.signIn.anonymous();
    if (error) throw new Error("Anonymous sign-in failed");
  };
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  await (locks ? locks.request(SESSION_LOCK, run) : run());
}
