/*
 * Logic shared by the service worker (sw.ts) and the pages. It has no DOM or worker types, so
 * both TypeScript programs can include it. tsc emits it next to sw.js as public/sw-shared.js.
 */

export type SwRoute = "network-only" | "network-first-offline" | "share-target" | "precache";

export interface SwRequestInfo {
  url: string;
  method: string;
  /** True for a top-level page load (`request.mode === "navigate"`). */
  navigate: boolean;
}

export const OFFLINE_PATH = "/offline";
export const SHARE_TARGET_PATH = "/share-target";

/** Where the service worker keeps files received through the Android share sheet. */
export const SHARE_CACHE = "cloud-share";
export const SHARE_KEY_PREFIX = "/share-target-files/";
export const SHARE_NAME_HEADER = "x-file-name";
export const SHARE_TIME_HEADER = "x-shared-at";
/** Shared files nobody uploaded are forgotten after this long. */
export const SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isShareId(value: string | null): value is string {
  return value !== null && SHARE_ID.test(value);
}

export function shareKey(id: string, index: number): string {
  return `${SHARE_KEY_PREFIX}${id}/${String(index)}`;
}

export function shareKeyPrefix(id: string): string {
  return `${SHARE_KEY_PREFIX}${id}/`;
}

/**
 * What the service worker does with a request. Nothing under /api is ever cached (file contents
 * and listings are private and must be fresh), and anything not listed goes straight to the
 * network untouched.
 */
export function routeOf(request: SwRequestInfo, origin: string): SwRoute {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return "network-only";
  }
  if (url.origin !== origin) {
    return "network-only";
  }
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) {
    return "network-only";
  }
  const method = request.method.toUpperCase();
  if (method === "POST" && path === SHARE_TARGET_PATH) {
    return "share-target";
  }
  if (method !== "GET") {
    return "network-only";
  }
  if (request.navigate) {
    return "network-first-offline";
  }
  if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) {
    return "precache";
  }
  return "network-only";
}

/** The hashed build files (scripts and styles) a page's HTML refers to. */
export function staticAssetsOf(html: string): string[] {
  const found = html.match(/\/_next\/static\/[^"'\s\\)<>]+/g) ?? [];
  return [...new Set(found)];
}
