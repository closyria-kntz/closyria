import { type AddressPolicy, strictPolicy } from "./address-policy";

/**
 * Test-only policy: also allows 127.0.0.1 (any port) so tests can reach the fake shop.
 * Never import it from worker code: policy-guard.test.ts fails if anything outside tests and
 * this file references it. The browser tests reach it through the `./capture/testing` export.
 */
export const loopbackForTests: AddressPolicy = Object.assign(
  (ip: string): boolean => ip === "127.0.0.1" || strictPolicy(ip),
  { anyPortOnLoopback: true as const },
);
