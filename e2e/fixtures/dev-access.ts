/**
 * dev.closyria.com's access page in the browser tests: the API of the stack runs with these (test values, not
 * secrets). The same-origin proxy does not play Caddy's cookie check (deploy/caddy/dev.closyria.com.caddy): the
 * journeys cover the page and the API, the Caddyfile is checked with `caddy validate`.
 */
export const E2E_DEV_ACCESS_PASSWORD = "mot-de-passe-des-tests";
export const E2E_DEV_ACCESS_TOKEN = "e2e0".repeat(16);
