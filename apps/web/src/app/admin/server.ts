import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { z } from "zod";
import { adminAccess } from "@/lib/admin-access";
import { fetchAdminJson, fetchAdminSession, type InternalApi, internalApiUrl } from "@/lib/admin-api";

// Server only: imported by the admin layouts and pages, never by a client component.

async function internalApi(): Promise<InternalApi> {
  return { fetch, baseUrl: internalApiUrl(process.env), cookie: (await headers()).get("cookie") ?? "" };
}

/** The access decision for this request, computed once even if several layouts ask. */
export const getAdminAccess = cache(async () => adminAccess(await fetchAdminSession(await internalApi())));

/**
 * Reads an admin API route with the visitor's cookies. A 401 or 403 means the session changed since the
 * layout checked it: answer 404 like the layout does. Any other refusal (e.g. a bad cursor) gives null.
 */
export async function adminRead<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const result = await fetchAdminJson(await internalApi(), path, schema);
  if (result.ok) return result.data;
  if (result.status === 401 || result.status === 403) notFound();
  return null;
}
