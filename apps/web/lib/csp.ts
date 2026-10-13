/*
 * The Content-Security-Policy of the web app. proxy.ts builds a fresh one per page request;
 * Next reads the nonce back out of the request's copy and puts it on its own scripts and styles.
 */

/** A fresh, unguessable nonce for one response. */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * `dev` relaxes what `next dev` needs: React rebuilds server stacks with eval, and the dev
 * server injects its styles as inline <style> elements.
 *
 * There is no style-src-attr: React sets the meters' widths through the CSSOM in the browser,
 * which a policy does not block. A style="" attribute in server-rendered HTML would be blocked.
 */
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ];
  return directives.join("; ");
}

/** Sent by next.config.ts. Caddy sends the same values, so a duplicate can never disagree. */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
] as const;
