"use client";

import { useSyncExternalStore } from "react";

/** A computer's width (64 rem and up): « Par étape », the two columns of « Accueil ». */
const DESKTOP_UP = "(min-width: 64rem)";
const subscribeDesktop = (onChange: () => void) => {
  const media = window.matchMedia(DESKTOP_UP);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/** True on a computer's width; false on the server and on a phone or a tablet. */
export const useDesktop = () =>
  useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_UP).matches,
    () => false,
  );

/** A finger rather than a mouse (phone, tablet): « Messenger » to share, « Coller le lien copié » to add. */
const COARSE = "(pointer: coarse)";
const subscribeCoarse = (onChange: () => void) => {
  const media = window.matchMedia(COARSE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/** True on a touch screen (phone or tablet); false on the server and with a mouse. */
export const useCoarsePointer = () =>
  useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia(COARSE).matches,
    () => false,
  );
