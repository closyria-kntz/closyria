import { isIPv4, isIPv6 } from "node:net";

/**
 * Decides whether safeFetch may connect to an IP address (`true` = allowed).
 * `anyPortOnLoopback` exists only for the test policy (capture/testing.ts): it lets the fake shop
 * listen on a random port of 127.0.0.1. Production code never sets it.
 */
export type AddressPolicy = ((ip: string) => boolean) & { readonly anyPortOnLoopback?: true };

// Spec §8, IPv4: [network, prefix length].
const FORBIDDEN_IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

const FORBIDDEN_IPV4_RANGES = FORBIDDEN_IPV4.map(([network, prefix]) => {
  const size = 2 ** (32 - prefix);
  const start = ipv4ToInt(network);
  return { start, end: start + size - 1 };
});

function ipv4Allowed(value: number): boolean {
  return !FORBIDDEN_IPV4_RANGES.some(({ start, end }) => value >= start && value <= end);
}

/** The eight 16-bit groups of a valid IPv6 address (embedded dotted quad included). */
function ipv6Groups(ip: string): number[] {
  let text = ip.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (dotted) {
    const v4 = ipv4ToInt(dotted);
    text = `${text.slice(0, -dotted.length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const middle = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...middle, ...right].map((group) => Number.parseInt(group, 16));
}

/**
 * Refuses every range of spec §8; IPv4-mapped IPv6 addresses are checked as IPv4. Also refuses
 * the other IPv6 forms that embed or route to IPv4 or local networks (see the comments below).
 */
export const strictPolicy: AddressPolicy = Object.freeze((input: string): boolean => {
  // A zone index (fe80::1%eth0) does not change the address.
  const ip = input.includes("%") ? input.slice(0, input.indexOf("%")) : input;
  if (isIPv4(ip)) return ipv4Allowed(ipv4ToInt(ip));
  if (!isIPv6(ip)) return false;
  const g = ipv6Groups(ip);
  if (g.length !== 8 || g.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embeddedV4 = g6 * 0x10000 + g7;
  const firstFiveZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // ::ffff:0:0/96: IPv4-mapped, checked as IPv4.
  if (firstFiveZero && g5 === 0xffff) return ipv4Allowed(embeddedV4);
  // ::ffff:0:0:0/96: IPv4-translated (SIIT), refused.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) return false;
  // ::/96 holds :: and ::1 (spec) and the deprecated IPv4-compatible addresses: all refused.
  if (firstFiveZero && g5 === 0) return false;
  // 64:ff9b::/96: NAT64, refused outright (spec §8).
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return false;
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return false; // 64:ff9b:1::/48, local NAT64 (RFC 8215)
  if (g0 === 0x2002) return false; // 2002::/16, 6to4 embeds an IPv4 address
  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return false; // fec0::/10, deprecated site-local
  if ((g0 & 0xff00) === 0xff00) return false; // ff00::/8
  return true;
});
