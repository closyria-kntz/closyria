import { describe, expect, it } from "vitest";
import { FRIEND_DEVICE_KEY, friendDevice } from "./friend-device";

/** A Storage held in a Map, like the browser's local storage. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

/** A storage that refuses everything (private browsing, blocked site data). */
const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
} as unknown as Storage;

describe("friendDevice", () => {
  it("gives a first visit a random 22-character key and no name", () => {
    const storage = memoryStorage();
    const device = friendDevice(storage);
    expect(device.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(device.name).toBeNull();
    expect(friendDevice(memoryStorage()).key).not.toBe(device.key);
  });

  it("keeps the same key and remembers the name on the next visit", () => {
    const storage = memoryStorage();
    const first = friendDevice(storage);
    first.setName("Léa");
    expect(first.name).toBe("Léa");
    const again = friendDevice(storage);
    expect(again.key).toBe(first.key);
    expect(again.name).toBe("Léa");
    expect(JSON.parse(storage.getItem(FRIEND_DEVICE_KEY) ?? "")).toEqual({ key: first.key, name: "Léa" });
  });

  it("becomes another friend on « Ce n'est pas toi ? »: a new key, no name, kept for the next visit", () => {
    const storage = memoryStorage();
    const device = friendDevice(storage);
    device.setName("Léa");
    const before = device.key;
    device.reset();
    expect(device.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(device.key).not.toBe(before);
    expect(device.name).toBeNull();
    const again = friendDevice(storage);
    expect(again.key).toBe(device.key);
    expect(again.name).toBeNull();
  });

  it("replaces a stored value it cannot read", () => {
    const storage = memoryStorage();
    storage.setItem(FRIEND_DEVICE_KEY, "{not json");
    expect(friendDevice(storage).key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    storage.setItem(FRIEND_DEVICE_KEY, JSON.stringify({ key: "short", name: 3 }));
    const device = friendDevice(storage);
    expect(device.key).not.toBe("short");
    expect(device.name).toBeNull();
  });

  it("still gives a key, kept in memory, when the storage throws or is missing", () => {
    for (const storage of [throwingStorage, null]) {
      const device = friendDevice(storage);
      expect(device.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(() => device.setName("Léa")).not.toThrow();
      expect(device.name).toBe("Léa");
    }
  });
});
