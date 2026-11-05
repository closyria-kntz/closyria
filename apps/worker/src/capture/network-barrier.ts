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

/**
 * The systemd unit forbids the worker from reaching local addresses (second line of defence behind safeFetch).
 * A direct TCP connection to 127.0.0.1:9 (discard, nothing listens) is refused with EPERM/EACCES when the
 * barrier is in place; any other outcome (ECONNREFUSED, success…) means it is absent.
 */
export async function checkNetworkBarrier(connect: Connect = tcpConnect): Promise<"active" | "absent"> {
  try {
    await connect("127.0.0.1", 9);
    return "absent";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "EPERM" || code === "EACCES" ? "active" : "absent";
  }
}
