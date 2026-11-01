/**
 * Baseline security headers for every page (task 13).
 *
 * The CSP is Report-Only for now: it is the strict target policy, observed before it is enforced.
 * Before enforcing, `script-src` needs per-request nonces (Next's inline bootstrap scripts are
 * reported today) and a report endpoint (`report-to`) must exist to see violations outside devtools.
 * `style-src 'unsafe-inline'` stays: Next and React inject inline styles.
 * Photos will be served from the OVH S3 host (Gravelines), hence the `img-src` pattern.
 * Passkeys (WebAuthn) need nothing in the CSP.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.s3.gra.io.cloud.ovh.net",
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
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
];
