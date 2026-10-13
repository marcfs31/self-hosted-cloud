import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./lib/csp";

const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:4000";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  async headers() {
    // The worker and its module must always be revalidated, or an update would never be noticed.
    const workers = ["/sw.js", "/sw-shared.js"].map((source) => ({
      source,
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Type", value: "text/javascript; charset=utf-8" },
      ],
    }));
    // Everything but /api, which the API answers with its own headers. The CSP comes from proxy.ts.
    return [{ source: "/((?!api(?:/|$)).*)", headers: [...SECURITY_HEADERS] }, ...workers];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default config;
