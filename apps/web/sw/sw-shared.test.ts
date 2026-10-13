import { describe, expect, it } from "vitest";
import {
  isShareId,
  routeOf,
  shareKey,
  shareKeyPrefix,
  staticAssetsOf,
  type SwRequestInfo,
} from "./sw-shared";

const ORIGIN = "https://cloud.example.test";

function route(path: string, method = "GET", navigate = false, origin = ORIGIN) {
  const request: SwRequestInfo = { url: `${origin}${path}`, method, navigate };
  return routeOf(request, ORIGIN);
}

describe("routeOf", () => {
  it("never touches /api, whatever the method or kind of request", () => {
    for (const method of ["GET", "POST", "PATCH", "DELETE", "HEAD"]) {
      for (const navigate of [true, false]) {
        expect(route("/api/files/root", method, navigate), `${method} ${String(navigate)}`).toBe(
          "network-only",
        );
      }
    }
    expect(route("/api/files/abc/content?download=1", "GET", true)).toBe("network-only");
    expect(route("/api/uploads/xyz", "PATCH")).toBe("network-only");
    expect(route("/api", "GET", true)).toBe("network-only");
  });

  it("is not fooled by paths that merely start with api", () => {
    expect(route("/apiary", "GET", true)).toBe("network-first-offline");
  });

  it("sends page loads to the network first, with the offline page as the fallback", () => {
    expect(route("/", "GET", true)).toBe("network-first-offline");
    expect(route("/folders/abc", "GET", true)).toBe("network-first-offline");
    expect(route("/share-target?id=1", "GET", true)).toBe("network-first-offline");
    expect(route("/offline", "GET", true)).toBe("network-first-offline");
  });

  it("hands the Android share-sheet POST to the share target", () => {
    expect(route("/share-target", "POST", true)).toBe("share-target");
    expect(route("/share-target", "post", true)).toBe("share-target");
  });

  it("leaves every other write alone", () => {
    expect(route("/share-target", "PUT", true)).toBe("network-only");
    expect(route("/", "POST", true)).toBe("network-only");
    expect(route("/trash", "DELETE")).toBe("network-only");
  });

  it("serves build files and icons from the cache", () => {
    expect(route("/_next/static/chunks/main-abc123.js")).toBe("precache");
    expect(route("/_next/static/css/app.css")).toBe("precache");
    expect(route("/icons/icon-192.png")).toBe("precache");
  });

  it("does not cache data requests that are not page loads", () => {
    expect(route("/folders/abc?_rsc=1x2y")).toBe("network-only");
    expect(route("/_next/image?url=%2Fx.png&w=64&q=75")).toBe("network-only");
    expect(route("/manifest.webmanifest")).toBe("network-only");
    expect(route("/sw.js")).toBe("network-only");
  });

  it("ignores other origins and unparseable URLs", () => {
    expect(route("/_next/static/a.js", "GET", false, "https://cdn.example.test")).toBe(
      "network-only",
    );
    expect(route("/", "GET", true, "https://evil.example.test")).toBe("network-only");
    expect(routeOf({ url: "not a url", method: "GET", navigate: true }, ORIGIN)).toBe(
      "network-only",
    );
  });
});

describe("share keys", () => {
  const id = "0b9d0c2e-6f0a-4c1e-9d0a-3f4f8f6a1b2c";

  it("accepts only a UUID as a share id", () => {
    expect(isShareId(id)).toBe(true);
    for (const bad of [null, "", "abc", `${id}x`, "../../etc/passwd", id.toUpperCase()]) {
      expect(isShareId(bad), String(bad)).toBe(false);
    }
  });

  it("keys every file of a share under the share's prefix", () => {
    expect(shareKey(id, 3)).toBe(`/share-target-files/${id}/3`);
    expect(shareKey(id, 0).startsWith(shareKeyPrefix(id))).toBe(true);
    expect(shareKey("other", 0).startsWith(shareKeyPrefix(id))).toBe(false);
  });
});

describe("staticAssetsOf", () => {
  it("collects each build file of a page once", () => {
    const html = `<link rel="stylesheet" href="/_next/static/css/a.css"/>
      <script src="/_next/static/chunks/b.js" async></script>
      <script src="/_next/static/chunks/b.js"></script>
      <script>self.__next_f.push(["/_next/static/chunks/c.js?dpl=1"])</script>`;
    expect(staticAssetsOf(html)).toEqual([
      "/_next/static/css/a.css",
      "/_next/static/chunks/b.js",
      "/_next/static/chunks/c.js?dpl=1",
    ]);
  });

  it("finds nothing in a page without build files", () => {
    expect(staticAssetsOf("<p>/static/nope</p>")).toEqual([]);
  });
});
