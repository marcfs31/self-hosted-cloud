import type { IncomingMessage } from "node:http";
import { DavError } from "./errors.js";
import { escapeText, parseXml, XmlError, type XmlElement } from "./xml.js";

export const DAV_NS = "DAV:";
export const MAX_XML_BODY = 64 * 1024;
const MAX_REQUESTED_PROPS = 64;

/** A request header as one string (repeated headers are joined, as HTTP defines). */
function header(req: Pick<IncomingMessage, "headers">, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

export interface PropName {
  ns: string;
  name: string;
}

/** Read a small request body (an XML document) into a string. 413 beyond `limit`, 415 when encoded. */
export function readBody(req: IncomingMessage, limit = MAX_XML_BODY): Promise<string> {
  const encoding = req.headers["content-encoding"]?.trim().toLowerCase();
  if (encoding && encoding !== "identity") return Promise.reject(new DavError(415));
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) return Promise.reject(new DavError(413));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (err?: Error): void => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", done);
      req.off("close", onClose);
      if (err) {
        req.pause();
        reject(err);
        return;
      }
      try {
        resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        reject(new DavError(400));
      }
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) done(new DavError(413));
      else chunks.push(chunk);
    };
    const onEnd = (): void => {
      done();
    };
    const onClose = (): void => {
      if (!req.complete) done(new Error("request aborted"));
    };
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", done);
    req.once("close", onClose);
  });
}

function parseBody(body: string): XmlElement | undefined {
  if (body.trim() === "") return undefined;
  try {
    return parseXml(body);
  } catch (err) {
    if (err instanceof XmlError) throw new DavError(400);
    throw err;
  }
}

function davChild(parent: XmlElement, name: string): XmlElement | undefined {
  return parent.children.find((c) => c.ns === DAV_NS && c.name === name);
}

function propNames(prop: XmlElement | undefined): PropName[] {
  return (prop?.children ?? []).map((c) => ({ ns: c.ns, name: c.name }));
}

export type PropfindRequest =
  { kind: "allprop" } | { kind: "propname" } | { kind: "prop"; props: PropName[] };

export function parsePropfind(body: string): PropfindRequest {
  const root = parseBody(body);
  if (!root) return { kind: "allprop" }; // RFC 4918: an empty body means allprop
  if (root.ns !== DAV_NS || root.name !== "propfind") throw new DavError(400);
  if (davChild(root, "propname")) return { kind: "propname" };
  if (davChild(root, "allprop")) return { kind: "allprop" };
  const prop = davChild(root, "prop");
  if (!prop) throw new DavError(400);
  const props = propNames(prop);
  // Every property is echoed for every resource of a listing: bound what one request can ask for.
  if (props.length > MAX_REQUESTED_PROPS) throw new DavError(400);
  return { kind: "prop", props };
}

/** The properties a PROPPATCH tries to set or remove. */
export function parsePropertyUpdate(body: string): PropName[] {
  const root = parseBody(body);
  if (root?.ns !== DAV_NS || root.name !== "propertyupdate") throw new DavError(400);
  const props: PropName[] = [];
  for (const action of root.children) {
    if (action.ns !== DAV_NS || (action.name !== "set" && action.name !== "remove")) continue;
    props.push(...propNames(davChild(action, "prop")));
  }
  return props;
}

export interface LockInfo {
  /** Already-escaped XML for the <owner> content, or undefined. */
  ownerXml: string | undefined;
}

const MAX_OWNER = 1024;

export function parseLockInfo(body: string): LockInfo | undefined {
  const root = parseBody(body);
  if (!root) return undefined; // a refresh carries no body
  if (root.ns !== DAV_NS || root.name !== "lockinfo") throw new DavError(400);
  const scope = davChild(root, "lockscope");
  const type = davChild(root, "locktype");
  if (!scope || !type || !davChild(type, "write")) throw new DavError(400);
  if (!davChild(scope, "exclusive")) throw new DavError(400);
  const owner = davChild(root, "owner");
  let ownerXml: string | undefined;
  if (owner) {
    const href = davChild(owner, "href");
    const text = (href ?? owner).text.trim().slice(0, MAX_OWNER);
    if (text !== "") {
      ownerXml = href ? `<D:href>${escapeText(text)}</D:href>` : escapeText(text);
    }
  }
  return { ownerXml };
}

/** Depth: "0", "1" or "infinity"; undefined when the header is absent, null when invalid. */
export function depthOf(
  req: Pick<IncomingMessage, "headers">,
): "0" | "1" | "infinity" | undefined | null {
  const raw = header(req, "depth")?.trim().toLowerCase();
  if (raw === undefined) return undefined;
  return raw === "0" || raw === "1" || raw === "infinity" ? raw : null;
}

/** `Overwrite: F` forbids replacing an existing destination; anything else (or nothing) allows it. */
export function overwriteAllowed(req: Pick<IncomingMessage, "headers">): boolean {
  const raw = header(req, "overwrite")?.trim().toUpperCase();
  if (raw === undefined || raw === "T") return true;
  if (raw === "F") return false;
  throw new DavError(400);
}

export const DEFAULT_LOCK_SECONDS = 3600;
export const MAX_LOCK_SECONDS = 3600;

/** The first usable `Second-N` of a Timeout header, clamped; the default for Infinite or none. */
export function lockTimeoutSeconds(req: Pick<IncomingMessage, "headers">): number {
  const raw = header(req, "timeout") ?? "";
  for (const option of raw.split(",")) {
    const match = /^\s*Second-(\d{1,10})\s*$/i.exec(option);
    if (match) return Math.min(Math.max(Number(match[1]), 1), MAX_LOCK_SECONDS);
  }
  return DEFAULT_LOCK_SECONDS;
}

/**
 * The state tokens a client submitted in its If header. Only lock tokens are evaluated (ETag
 * conditions and resource tags are ignored); a token under "Not" is not a submission.
 */
export function submittedTokens(req: Pick<IncomingMessage, "headers">): Set<string> {
  const tokens = new Set<string>();
  const conditions = header(req, "if") ?? "";
  for (const list of conditions.matchAll(/\(([^)]*)\)/g)) {
    for (const item of (list[1] ?? "").matchAll(/(Not\s*)?<([^>]{1,200})>/gi)) {
      if (!item[1]) tokens.add(item[2] ?? "");
    }
  }
  return tokens;
}

/** The token of an UNLOCK request's Lock-Token header (`<token>`), or undefined. */
export function lockTokenHeader(req: Pick<IncomingMessage, "headers">): string | undefined {
  const match = /^\s*<([^>]{1,200})>\s*$/.exec(header(req, "lock-token") ?? "");
  return match?.[1];
}

/** True when the request declares a body (MKCOL must have none). */
export function hasBody(req: Pick<IncomingMessage, "headers">): boolean {
  const length = req.headers["content-length"];
  return (
    (length !== undefined && length.trim() !== "0") ||
    req.headers["transfer-encoding"] !== undefined
  );
}
