"use client";

import { useEffect } from "react";
import { checkThisDeviceOnce, pushSupport, readPushEnvironment } from "@/lib/push";

/**
 * Once per page load, on every app page: a push subscription this browser holds for another account (a shared
 * computer left without « Se déconnecter »), with an unknown owner, or removed elsewhere is dropped
 * (`checkThisDevice`); only « Activer » subscribes again. Nothing at all where push is unsupported; never asks for the
 * permission. Renders nothing.
 */
export function ThisDeviceCheck() {
  useEffect(() => {
    if (pushSupport(readPushEnvironment()) !== "supported") return;
    void checkThisDeviceOnce();
  }, []);
  return null;
}
