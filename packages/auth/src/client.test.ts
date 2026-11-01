import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSession, type SessionClient } from "./client";

/** Exclusive locks run one callback at a time per name, like the Web Locks API. */
function fakeLocks() {
  const queues = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  return {
    names,
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      names.push(name);
      const previous = queues.get(name) ?? Promise.resolve();
      const result = previous.then(callback);
      queues.set(
        name,
        result.catch(() => {}),
      );
      return result;
    },
  };
}

/** A client whose session only exists after an anonymous sign-in that takes some time. */
function fakeClient() {
  let session: { id: string } | null = null;
  const signIns = { count: 0 };
  const client: SessionClient = {
    getSession: async () => ({ data: session }),
    signIn: {
      anonymous: async () => {
        signIns.count++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        session = { id: `anon-${signIns.count}` };
        return { error: null };
      },
    },
  };
  return { client, signIns };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureSession", () => {
  it("signs in anonymously only once when two tabs ask at the same time", async () => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    const { client, signIns } = fakeClient();

    await Promise.all([ensureSession(client), ensureSession(client)]);

    expect(signIns.count).toBe(1);
    expect(locks.names).toEqual(["closyria-session", "closyria-session"]);
  });

  it("does nothing when a session already exists", async () => {
    vi.stubGlobal("navigator", { locks: fakeLocks() });
    const { client, signIns } = fakeClient();
    await ensureSession(client);
    await ensureSession(client);
    expect(signIns.count).toBe(1);
  });

  it("still signs in where the Web Locks API is missing", async () => {
    vi.stubGlobal("navigator", {});
    const { client, signIns } = fakeClient();
    await ensureSession(client);
    expect(signIns.count).toBe(1);
  });

  it("throws when the anonymous sign-in fails", async () => {
    vi.stubGlobal("navigator", { locks: fakeLocks() });
    const client: SessionClient = {
      getSession: async () => ({ data: null }),
      signIn: { anonymous: async () => ({ error: { status: 500 } }) },
    };
    await expect(ensureSession(client)).rejects.toThrow();
  });
});
