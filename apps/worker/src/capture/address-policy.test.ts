import { describe, expect, it } from "vitest";
import { strictPolicy } from "./address-policy";
import { loopbackForTests } from "./testing";

describe("strictPolicy", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
  ])("refuses %s", (ip) => {
    expect(strictPolicy(ip)).toBe(false);
  });

  it.each(["51.38.1.1", "2001:41d0::1"])("accepts %s", (ip) => {
    expect(strictPolicy(ip)).toBe(true);
  });

  // Both ends of every IPv4 range of spec §8, and the first address outside it.
  it.each([
    ["0.0.0.0/8", ["0.0.0.0", "0.255.255.255"], ["1.0.0.0"]],
    ["10.0.0.0/8", ["10.0.0.0", "10.255.255.255"], ["9.255.255.255", "11.0.0.0"]],
    ["100.64.0.0/10", ["100.64.0.0", "100.127.255.255"], ["100.63.255.255", "100.128.0.0"]],
    ["127.0.0.0/8", ["127.0.0.0", "127.255.255.255"], ["126.255.255.255", "128.0.0.0"]],
    ["169.254.0.0/16", ["169.254.0.0", "169.254.255.255"], ["169.253.255.255", "169.255.0.0"]],
    ["172.16.0.0/12", ["172.16.0.0", "172.31.255.255"], ["172.15.255.255", "172.32.0.0"]],
    ["192.0.0.0/24", ["192.0.0.0", "192.0.0.255"], ["191.255.255.255", "192.0.1.0"]],
    ["192.168.0.0/16", ["192.168.0.0", "192.168.255.255"], ["192.167.255.255", "192.169.0.0"]],
    ["198.18.0.0/15", ["198.18.0.0", "198.19.255.255"], ["198.17.255.255", "198.20.0.0"]],
    ["224.0.0.0/4", ["224.0.0.0", "239.255.255.255"], ["223.255.255.255"]],
    ["240.0.0.0/4", ["240.0.0.0", "255.255.255.255"], []],
  ] as const)("IPv4 %s", (_range, inside, outside) => {
    for (const ip of inside) expect(strictPolicy(ip), ip).toBe(false);
    for (const ip of outside) expect(strictPolicy(ip), ip).toBe(true);
  });

  it.each([
    ["::", ["::", "0:0:0:0:0:0:0:0"], []],
    ["::1", ["::1", "0:0:0:0:0:0:0:1"], []],
    ["fc00::/7", ["fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "FD12::1"], ["fbff:ffff::1", "fe00::1"]],
    ["fe80::/10", ["fe80::", "febf:ffff::1", "fe80::1%eth0"], ["fe7f::1"]],
    ["ff00::/8", ["ff00::", "ff02::1", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"], ["feff::1"]],
    [
      "::ffff:0:0/96 (checked as IPv4)",
      ["::ffff:127.0.0.1", "::ffff:7f00:1", "::FFFF:7F00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "::ffff:0:0"],
      ["::ffff:51.38.1.1", "::ffff:3326:101"],
    ],
    [
      "64:ff9b::/96",
      ["64:ff9b::7f00:1", "64:ff9b::808:808", "64:ff9b::8.8.8.8", "64:ff9b:0:0:0:0:ffff:ffff"],
      ["64:ff9b:0:0:0:1::1", "64:ff9a::1"],
    ],
  ] as const)("IPv6 %s", (_range, inside, outside) => {
    for (const ip of inside) expect(strictPolicy(ip), ip).toBe(false);
    for (const ip of outside) expect(strictPolicy(ip), ip).toBe(true);
  });

  it.each(["", "localhost", "example.com", "1.2.3", "256.0.0.1", "::ffff:999.1.1.1", "[::1]", "1::2::3"])(
    "refuses what is not an IP address: %s",
    (value) => {
      expect(strictPolicy(value)).toBe(false);
    },
  );
});

describe("loopbackForTests", () => {
  it("accepts 127.0.0.1 and public addresses", () => {
    expect(loopbackForTests("127.0.0.1")).toBe(true);
    expect(loopbackForTests("51.38.1.1")).toBe(true);
  });

  it.each(["127.0.0.2", "10.0.0.1", "::1", "::ffff:127.0.0.1", "169.254.169.254"])("refuses %s", (ip) => {
    expect(loopbackForTests(ip)).toBe(false);
  });
});
