import net from "node:net";

export type Connect = (host: string, port: number) => Promise<void>;

const tcpConnect: Connect = (host, port) =>
  new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(2_000, () => socket.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
  });

export type BarrierCheck = { state: "active" | "absent"; reason: string };

/** Outcomes of a connection to a closed local port that only a firewall can produce. */
const BLOCKED = new Set(["ETIMEDOUT", "EPERM", "EACCES"]);

/**
 * The systemd unit forbids the worker from reaching local addresses (second line of defence behind safeFetch).
 * A direct TCP connection to 127.0.0.1:9 (discard, nothing listens) is refused at once (ECONNREFUSED) without
 * the barrier. With it, systemd's IPAddressDeny drops the packets silently (measured on the server on
 * 2026-11-05: timeout), or the kernel answers EPERM/EACCES. `reason` is the observed code, for the log.
 */
export async function checkNetworkBarrier(connect: Connect = tcpConnect): Promise<BarrierCheck> {
  try {
    await connect("127.0.0.1", 9);
    return { state: "absent", reason: "connected" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "unknown";
    return { state: BLOCKED.has(code) ? "active" : "absent", reason: code };
  }
}
