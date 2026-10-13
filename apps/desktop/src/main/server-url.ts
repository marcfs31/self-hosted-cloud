import type { ValidationCode } from "../ipc/types.js";

/** localhost, 127.0.0.1, [::1] and *.localhost: the only hosts that may be reached without TLS. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")
  );
}

export type ServerCheck = { ok: true; origin: string } | { ok: false; code: ValidationCode };

/**
 * The server setting is an origin. https is required except for local hosts; credentials, a path,
 * a query or a fragment are refused rather than silently dropped. A bare host name means https.
 */
export function normalizeServer(raw: string): ServerCheck {
  const text = raw.trim();
  if (text === "") return { ok: false, code: "server_required" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: "server_invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, code: "server_invalid" };
  }
  if (
    url.hostname === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/"
  ) {
    return { ok: false, code: "server_invalid" };
  }
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    return { ok: false, code: "server_insecure" };
  }
  return { ok: true, origin: url.origin };
}

/**
 * The only URLs the app hands to the operating system's browser: on the configured server's own
 * origin, over https (or http for a local host). Everything else, including other origins,
 * userinfo tricks and non-web schemes, is refused.
 */
export function allowedExternalUrl(
  candidate: string,
  configuredServer: string | undefined,
): URL | undefined {
  if (configuredServer === undefined) return undefined;
  const server = normalizeServer(configuredServer);
  if (!server.ok) return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) return undefined;
  return url.origin === server.origin ? url : undefined;
}
