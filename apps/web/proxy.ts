import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, newNonce } from "./lib/csp";

/** Gives every page response its own nonce-based Content-Security-Policy. */
export function proxy(request: NextRequest) {
  const policy = contentSecurityPolicy(newNonce(), process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: the API sets its own headers, and static files have no scripts to guard.
      source: "/((?!api(?:/|$)|_next/static|_next/image|icons/|favicon\\.ico$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
