"use client";

import { createAuthClient } from "@closyria/auth/client";
import { useState } from "react";
import { buttonClass, primaryButtonClass } from "../ui";

type Labels = { register: string; signIn: string; registered: string; registerFailed: string; signInFailed: string };
type Status = "idle" | "busy" | "registered" | "registerFailed" | "signInFailed";

/** The API is on the same origin, under /api/auth. */
const authClient = () => createAuthClient(window.location.origin);

/** Registers a passkey on this device, then signs in with it and reloads into the admin. */
export function PasskeyActions({ labels }: { labels: Labels }) {
  const [status, setStatus] = useState<Status>("idle");
  const busy = status === "busy";

  const register = async () => {
    setStatus("busy");
    // A browser without WebAuthn, or a cancelled prompt, must end in a message, not a stuck button.
    const result = await authClient()
      .passkey.addPasskey()
      .catch(() => ({ error: true }));
    setStatus(result.error ? "registerFailed" : "registered");
  };

  const signIn = async () => {
    setStatus("busy");
    const result = await authClient()
      .signIn.passkey()
      .catch(() => ({ error: true }));
    if (result.error) return setStatus("signInFailed");
    // A full load: the server reads the new passkey session.
    window.location.assign("/admin");
  };

  const message =
    status === "registered" || status === "registerFailed" || status === "signInFailed" ? labels[status] : "";
  const failed = status === "registerFailed" || status === "signInFailed";

  return (
    <div className="flex flex-col gap-space-3">
      <div className="flex flex-wrap gap-space-2">
        <button type="button" className={buttonClass} onClick={register} disabled={busy}>
          {labels.register}
        </button>
        <button type="button" className={primaryButtonClass} onClick={signIn} disabled={busy}>
          {labels.signIn}
        </button>
      </div>
      <p role="status" aria-live="polite" className={failed ? "text-danger" : "text-success"}>
        {message}
      </p>
    </div>
  );
}
