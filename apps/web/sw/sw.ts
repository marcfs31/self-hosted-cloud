import {
  OFFLINE_PATH,
  SHARE_CACHE,
  SHARE_MAX_AGE_MS,
  SHARE_NAME_HEADER,
  SHARE_TARGET_PATH,
  SHARE_TIME_HEADER,
  routeOf,
  shareKey,
  staticAssetsOf,
} from "./sw-shared.js";

/*
 * The service worker: it makes the app installable and shows a friendly page when the server
 * cannot be reached. It never stores anything from /api (see routeOf), so no file or listing
 * is kept on the device by it. The only user data it holds are files received through the
 * Android share sheet, until the person uploads or discards them (see SHARE_CACHE).
 */

const sw = self as unknown as ServiceWorkerGlobalScope;

/** Bump to drop everything this worker cached before. */
const CACHE = "cloud-shell-v1";
const PRECACHED = ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg"];
/** The offline page is refreshed after a visit, at most this often, so it follows the language. */
const OFFLINE_REFRESH_MS = 10 * 60 * 1000;
let lastOfflineRefresh = 0;

async function storeOfflinePage(): Promise<void> {
  const cache = await caches.open(CACHE);
  const response = await fetch(OFFLINE_PATH, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error("offline page unavailable");
  }
  const assets = staticAssetsOf(await response.clone().text());
  await cache.put(OFFLINE_PATH, response);
  await Promise.allSettled([...assets, ...PRECACHED].map((path) => cache.add(path)));
}

sw.addEventListener("install", (event) => {
  // A failed precache (for example no network during install) must not block the update.
  event.waitUntil(
    storeOfflinePage()
      .catch(() => undefined)
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("cloud-shell-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await sw.clients.claim();
    })(),
  );
});

function offlineResponse(): Promise<Response> {
  return caches.match(OFFLINE_PATH, { cacheName: CACHE }).then(
    (cached) =>
      cached ??
      new Response("Cloud can't be reached right now.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
  );
}

const GATEWAY_ERRORS = new Set([502, 503, 504]);

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (GATEWAY_ERRORS.has(response.status)) {
      return await offlineResponse();
    }
    return response;
  } catch {
    return offlineResponse();
  }
}

async function refreshOfflinePage(): Promise<void> {
  if (Date.now() - lastOfflineRefresh < OFFLINE_REFRESH_MS) {
    return;
  }
  lastOfflineRefresh = Date.now();
  await storeOfflinePage().catch(() => {
    lastOfflineRefresh = 0;
  });
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) {
    return hit;
  }
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
  }
  return response;
}

async function forgetOldShares(cache: Cache): Promise<void> {
  const now = Date.now();
  for (const key of await cache.keys()) {
    const stored = await cache.match(key);
    const at = Number(stored?.headers.get(SHARE_TIME_HEADER));
    if (!Number.isFinite(at) || now - at > SHARE_MAX_AGE_MS) {
      await cache.delete(key);
    }
  }
}

/** Keeps the files of a share-sheet POST and sends the browser on to the page that uploads them. */
async function receiveShare(request: Request): Promise<Response> {
  const id = crypto.randomUUID();
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    const cache = await caches.open(SHARE_CACHE);
    await forgetOldShares(cache);
    const sharedAt = String(Date.now());
    await Promise.all(
      files.map((file, index) =>
        cache.put(
          shareKey(id, index),
          new Response(file, {
            headers: {
              "content-type": file.type === "" ? "application/octet-stream" : file.type,
              [SHARE_NAME_HEADER]: encodeURIComponent(file.name),
              [SHARE_TIME_HEADER]: sharedAt,
            },
          }),
        ),
      ),
    );
  } catch {
    // The page shows its empty state for an id that has no files.
  }
  return Response.redirect(new URL(`${SHARE_TARGET_PATH}?id=${id}`, sw.location.origin).href, 303);
}

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  const route = routeOf(
    { url: request.url, method: request.method, navigate: request.mode === "navigate" },
    sw.location.origin,
  );
  switch (route) {
    case "network-only":
      return;
    case "share-target":
      event.respondWith(receiveShare(request));
      return;
    case "network-first-offline":
      event.respondWith(networkFirst(request));
      event.waitUntil(refreshOfflinePage());
      return;
    case "precache":
      event.respondWith(cacheFirst(request));
      return;
  }
});
