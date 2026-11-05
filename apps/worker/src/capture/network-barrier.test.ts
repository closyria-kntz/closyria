import { describe, expect, it } from "vitest";
import { checkNetworkBarrier } from "./network-barrier";

const failing = (code: string) => async () => {
  throw Object.assign(new Error(code), { code });
};

describe("checkNetworkBarrier", () => {
  it("is absent locally (real connection to 127.0.0.1:9 is refused at once, not dropped)", async () => {
    expect(await checkNetworkBarrier()).toEqual({ state: "absent", reason: "ECONNREFUSED" });
  });
  it("is active when the connection is dropped (systemd's IPAddressDeny: silent drop, then timeout)", async () => {
    expect(await checkNetworkBarrier(failing("ETIMEDOUT"))).toEqual({ state: "active", reason: "ETIMEDOUT" });
  });
  it("is active on EPERM and EACCES", async () => {
    expect(await checkNetworkBarrier(failing("EPERM"))).toEqual({ state: "active", reason: "EPERM" });
    expect(await checkNetworkBarrier(failing("EACCES"))).toEqual({ state: "active", reason: "EACCES" });
  });
  it("is absent when the connection is refused or succeeds", async () => {
    expect(await checkNetworkBarrier(failing("ECONNREFUSED"))).toEqual({ state: "absent", reason: "ECONNREFUSED" });
    expect(await checkNetworkBarrier(async () => undefined)).toEqual({ state: "absent", reason: "connected" });
  });
  it("is absent, with the code, on any other error", async () => {
    expect(await checkNetworkBarrier(failing("EHOSTUNREACH"))).toEqual({ state: "absent", reason: "EHOSTUNREACH" });
    expect(await checkNetworkBarrier(async () => Promise.reject(new Error("x")))).toEqual({
      state: "absent",
      reason: "unknown",
    });
  });
});
