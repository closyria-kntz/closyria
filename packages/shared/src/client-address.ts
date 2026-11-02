/**
 * The visitor's address: the last `X-Forwarded-For` entry, which Caddy overwrites with the address it saw.
 * Earlier entries are whatever the client sent. Undefined when the header is missing or empty.
 * Used by the API's own limits and by the web when it calls the API on a visitor's behalf.
 */
export function lastForwardedAddress(header: string | null | undefined): string | undefined {
  return header
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
}
