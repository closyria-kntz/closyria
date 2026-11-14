import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { z } from "zod";
import { loadAdminAccess } from "@/lib/admin-access";
import { type AdminResult, fetchAdminJson, fetchAdminSession, type InternalApi, internalApiFor } from "@/lib/admin-api";
import { ADMIN_PATH_HEADER, signInHref } from "@/lib/sign-in";

// Server only: imported by the admin layouts and pages, never by a client component.

async function internalApi(): Promise<InternalApi> {
  return internalApiFor(await headers(), process.env);
}

/** The access decision for this request, computed once even if several layouts ask. */
export const getAdminAccess = cache(async () => {
  // Outside the try of loadAdminAccess: headers() must keep throwing Next's dynamic-rendering signal.
  const api = await internalApi();
  return loadAdminAccess(() => fetchAdminSession(api));
});

/**
 * Sends a visitor who is not signed in to an account to the sign-in page, back to the admin address she asked for
 * (set by `proxy.ts`; the admin home when it is missing). Called wherever the access is decided.
 */
export async function redirectToSignIn(): Promise<never> {
  redirect(signInHref((await headers()).get(ADMIN_PATH_HEADER) ?? "/admin"));
}

/**
 * Guard called by every admin page itself, not only by the layouts: a page must stay closed even if a
 * layout is moved or skipped. The sign-in page for a visitor without an account, 404 for non-admins (R15); an
 * admin without passkey session goes to the page explaining passkeys. That page passes `allowPasskeyRequired` (it is where those admins land).
 */
export async function requireAdminPage(options: { allowPasskeyRequired?: boolean } = {}): Promise<void> {
  const access = await getAdminAccess();
  if (access === "sign-in") await redirectToSignIn();
  if (access === "not-found") notFound();
  if (access === "passkey-required" && !options.allowPasskeyRequired) redirect("/admin/passkey-required");
}

/**
 * An admin API read through one of the `fetchAdmin*` helpers, with the visitor's cookies. A 401 or 403 means
 * the session changed since the layout checked it: answer 404 like the layout does. Any other refusal is a
 * result for the page to interpret; a server error throws.
 */
export async function adminCall<T>(call: (api: InternalApi) => Promise<AdminResult<T>>): Promise<AdminResult<T>> {
  const result = await call(await internalApi());
  if (!result.ok && (result.status === 401 || result.status === 403)) notFound();
  return result;
}

/** Like `adminCall`, for a read that must succeed: any refusal throws, so the admin error page shows (never empty data). */
export async function adminCallOrThrow<T>(
  what: string,
  call: (api: InternalApi) => Promise<AdminResult<T>>,
): Promise<T> {
  const result = await adminCall(call);
  if (!result.ok) throw new Error(`${what} answered ${result.status}`);
  return result.data;
}

/** Reads an admin API route by path; null for a refusal other than 401/403. */
export async function adminRead<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const result = await adminCall((api) => fetchAdminJson(api, path, schema));
  return result.ok ? result.data : null;
}
