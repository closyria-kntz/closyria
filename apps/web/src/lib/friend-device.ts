import { deviceKeySchema } from "@closyria/shared";
import { z } from "zod";

/** Where a friend's device key and first name live in the browser's local storage (spec §3.2). */
export const FRIEND_DEVICE_KEY = "closyria-friend";

const storedSchema = z.object({ key: deviceKeySchema, name: z.string().min(1).nullable() });

export type FriendDevice = {
  /** Random, 16 bytes in base64url: what lets her change or erase her opinions from this device. */
  readonly key: string;
  /** Her first name, once she gave it on this device. */
  readonly name: string | null;
  setName(name: string): void;
  /** « Ce n'est pas toi ? »: another friend on this device (a shared tablet). A new key, no name. */
  reset(): void;
};

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function read(storage: Storage | null): z.infer<typeof storedSchema> | null {
  try {
    const raw = storage?.getItem(FRIEND_DEVICE_KEY);
    if (!raw) return null;
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null, value: z.infer<typeof storedSchema>): void {
  try {
    storage?.setItem(FRIEND_DEVICE_KEY, JSON.stringify(value));
  } catch {
    // Private browsing or blocked site data: the key stays in memory for this visit.
  }
}

/**
 * This device as a friend: its key (made on the first visit) and her first name. No account, no cookie; when the
 * storage cannot be used, everything is kept in memory for the visit.
 */
export function friendDevice(storage: Storage | null): FriendDevice {
  const stored = read(storage);
  const state = stored ?? { key: randomKey(), name: null };
  if (!stored) write(storage, state);
  return {
    get key() {
      return state.key;
    },
    get name() {
      return state.name;
    },
    setName(name: string) {
      state.name = name;
      write(storage, state);
    },
    reset() {
      state.key = randomKey();
      state.name = null;
      write(storage, state);
    },
  };
}
