/**
 * Baseline security headers for every page (task 13).
 *
 * The CSP is Report-Only for now: it is the strict target policy, observed before it is enforced.
 * Before enforcing, `script-src` needs per-request nonces (Next's inline bootstrap scripts are
 * reported today) and a report endpoint (`report-to`) must exist to see violations outside devtools.
 * `style-src 'unsafe-inline'` stays: Next and React inject inline styles.
 * Photos will be served from OVH S3 (Gravelines). s3Store uses path-style URLs
 * (`https://s3.gra.io.cloud.ovh.net/<bucket>/<key>`), so `img-src` names that exact host, the default
 * S3_ENDPOINT (deploy/README.md): change both together.
 * Passkeys (WebAuthn) need nothing in the CSP.
 *
 * Framing is the exception, enforced now: a separate enforced CSP holding only `frame-ancestors 'none'`
 * (nothing else, so Next's inline scripts keep working), and `X-Frame-Options: DENY` for older browsers.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://s3.gra.io.cloud.ovh.net",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
];
