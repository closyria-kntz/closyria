/**
 * Browser-side entry, bundled by the global setup (esbuild) and injected into every page with
 * `addInitScript`. It exposes the web app's real auth client and `ensureSession` (Web Locks included) to
 * the tests, which drive them with `page.evaluate`: the app has no sign-in screen yet, and nothing is
 * added to the app for the tests.
 */
import { createAuthClient, ensureSession } from "@closyria/auth/client";

export type BrowserSession = { userId: string; email: string; isAnonymous: boolean } | null;
export type BrowserResult = { ok: true } | { ok: false; error: string };

export type BrowserAuth = {
  /** What the app's first action will call: an anonymous session unless one exists. */
  ensureSession(): Promise<BrowserResult>;
  session(): Promise<BrowserSession>;
  sendCode(email: string): Promise<BrowserResult>;
  signInWithCode(email: string, otp: string): Promise<BrowserResult>;
};

declare global {
  interface Window {
    closyriaE2E: BrowserAuth;
  }
}

/** Same origin as the page: the API is served under /api, as in production. */
const client = () => createAuthClient(window.location.origin);

const describe = (error: unknown) =>
  error instanceof Error ? error.message : JSON.stringify(error ?? "unknown error");

const settle = async (run: () => Promise<{ error?: unknown } | undefined>): Promise<BrowserResult> => {
  try {
    const result = await run();
    return result?.error ? { ok: false, error: describe(result.error) } : { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
};

window.closyriaE2E = {
  ensureSession: () =>
    settle(async () => {
      await ensureSession(client());
      return undefined;
    }),
  async session() {
    const { data } = await client().getSession();
    if (!data) return null;
    const user = data.user as { id: string; email: string; isAnonymous?: boolean | null };
    return { userId: user.id, email: user.email, isAnonymous: user.isAnonymous === true };
  },
  sendCode: (email) => settle(() => client().emailOtp.sendVerificationOtp({ email, type: "sign-in" })),
  signInWithCode: (email, otp) => settle(() => client().signIn.emailOtp({ email, otp })),
};
