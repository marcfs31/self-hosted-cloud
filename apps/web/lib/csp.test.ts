import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, contentSecurityPolicy, newNonce } from "./csp";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((part) => {
      const [name = "", ...values] = part.split(" ");
      return [name, values];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  const production = directives(contentSecurityPolicy("abc123", false));

  it("allows scripts only from this origin and by nonce, never inline or eval", () => {
    expect(production.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(production.get("default-src")).toEqual(["'self'"]);
  });

  it("closes framing, base, plugins and cross-origin submission and connection", () => {
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
    expect(production.get("base-uri")).toEqual(["'none'"]);
    expect(production.get("object-src")).toEqual(["'none'"]);
    expect(production.get("form-action")).toEqual(["'self'"]);
    expect(production.get("connect-src")).toEqual(["'self'"]);
    expect(production.get("frame-src")).toEqual(["'self'"]);
  });

  it("lets previews use blob and data URLs but loads nothing from other origins", () => {
    expect(production.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(production.get("media-src")).toEqual(["'self'", "blob:"]);
    expect(production.get("worker-src")).toEqual(["'self'"]);
    expect(production.get("manifest-src")).toEqual(["'self'"]);
    const everything = [...production.values()].flat();
    expect(everything.filter((value) => /^https?:|\*/.test(value))).toEqual([]);
  });

  it("uses the nonce for styles in production, with no unsafe-inline anywhere", () => {
    expect(production.get("style-src")).toEqual(["'self'", "'nonce-abc123'"]);
    expect([...production.values()].flat()).not.toContain("'unsafe-inline'");
  });

  it("relaxes only eval and inline styles for next dev", () => {
    const dev = directives(contentSecurityPolicy("abc123", true));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(production.get("script-src")).not.toContain("'unsafe-eval'");
  });
});

describe("newNonce", () => {
  it("is different every time and safe inside a CSP source", () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
  });
});

describe("SECURITY_HEADERS", () => {
  it("matches what deploy/Caddyfile sends", () => {
    expect(Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key, value]))).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    });
  });
});
