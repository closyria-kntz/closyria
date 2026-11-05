import { describe, expect, it } from "vitest";
import { checkNetworkBarrier } from "./network-barrier";

const failing = (code: string) => async () => {
  throw Object.assign(new Error(code), { code });
};

describe("checkNetworkBarrier", () => {
  it("is absent locally (real connection to 127.0.0.1:9 is refused, not forbidden)", async () => {
    expect(await checkNetworkBarrier()).toBe("absent");
  });
  it("is active on EPERM and EACCES", async () => {
    expect(await checkNetworkBarrier(failing("EPERM"))).toBe("active");
    expect(await checkNetworkBarrier(failing("EACCES"))).toBe("active");
  });
  it("is absent on any other outcome", async () => {
    expect(await checkNetworkBarrier(failing("ECONNREFUSED"))).toBe("absent");
    expect(await checkNetworkBarrier(failing("ETIMEDOUT"))).toBe("absent");
    expect(await checkNetworkBarrier(async () => undefined)).toBe("absent");
  });
});
