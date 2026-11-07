"use client";

import { useEffect, useRef } from "react";
import { createReturnGate } from "./refresh-on-return";
import { fetchChangesStamp } from "./wardrobe-client";

/** How often an open page asks whether something changed (on her phone, in another tab). */
export const LIVE_POLL_MS = 10_000;

export type ChangeSubscriber = { refresh: () => void; enabled: boolean; seen?: string | null };

/**
 * Hands each new stamp to the open pages. A page refreshes only when the stamp moved since its own last refresh;
 * a paused page (a selection in progress) gets the change once it resumes.
 */
export function createChangeHub() {
  const subscribers = new Set<ChangeSubscriber>();
  let current: string | null = null;
  const deliver = (sub: ChangeSubscriber) => {
    if (current === null) return;
    // The first stamp a page meets is the state it just read.
    if (sub.seen === null || sub.seen === undefined) sub.seen = current;
    if (!sub.enabled || sub.seen === current) return;
    sub.seen = current;
    sub.refresh();
  };
  return {
    publish(stamp: string) {
      current = stamp;
      for (const sub of subscribers) deliver(sub);
    },
    subscribe(sub: ChangeSubscriber): ChangeSubscriber {
      sub.seen = current;
      subscribers.add(sub);
      return sub;
    },
    unsubscribe(sub: ChangeSubscriber) {
      subscribers.delete(sub);
    },
    setEnabled(sub: ChangeSubscriber, enabled: boolean) {
      sub.enabled = enabled;
      deliver(sub);
    },
  };
}

const hub = createChangeHub();

/**
 * The page's data again whenever something changed elsewhere, without her touching anything. Paused while
 * `enabled` is false (a selection, a rename in progress); a change seen meanwhile comes once it resumes.
 */
export function useLiveRefresh(refresh: () => void, enabled = true) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  const sub = useRef<ChangeSubscriber | null>(null);
  useEffect(() => {
    const mine = hub.subscribe({ refresh: () => latest.current(), enabled: false });
    sub.current = mine;
    return () => {
      hub.unsubscribe(mine);
      sub.current = null;
    };
  }, []);
  useEffect(() => {
    if (sub.current) hub.setEnabled(sub.current, enabled);
  }, [enabled]);
}

/**
 * Asks for the stamp every LIVE_POLL_MS while the page is on screen, and at once when she comes back to it.
 * Waits while a window (dialog) is open or the page is hidden. Without a session yet, it keeps asking (cheap):
 * her first action creates one. Mounted once, in the shell.
 */
export function useChangesPoller() {
  useEffect(() => {
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped || busy || document.visibilityState !== "visible") return;
      if (document.querySelector("dialog[open]")) return;
      busy = true;
      try {
        const stamp = await fetchChangesStamp();
        if (stamp !== null) hub.publish(stamp);
      } catch {
        // Offline or a hiccup: the next tick asks again.
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), LIVE_POLL_MS);
    const gate = createReturnGate(Date.now());
    const onReturn = () => {
      const state = { visible: document.visibilityState === "visible", dialogOpen: false, now: Date.now() };
      if (gate(state)) void tick();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, []);
}
