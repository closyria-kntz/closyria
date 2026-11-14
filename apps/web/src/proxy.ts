import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_PATH_HEADER } from "./lib/sign-in";

/**
 * Tells the admin layouts which address was asked for, so a visitor who is not signed in comes back to it after
 * signing in (comptes visibles 2026-11-14). The header is always overwritten here: a value sent by the browser is
 * never read. The page itself still sanitises it (`safeNext`).
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(ADMIN_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
