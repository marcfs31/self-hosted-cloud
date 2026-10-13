import { XML_DECLARATION } from "./errors.js";
import { activeLockXml, type Lock } from "./locks.js";
import { hrefFor } from "./paths.js";
import { DAV_NS, type PropfindRequest, type PropName } from "./requests.js";
import { escapeAttribute, escapeText } from "./xml.js";

export interface DavResource {
  /** Names from the root; empty for the root itself. */
  segments: string[];
  collection: boolean;
  size: number;
  mime: string;
  /** The current version of a file; its ID is the entity tag. */
  versionId: string | null;
  created: Date;
  modified: Date;
}

export interface PropContext {
  quotaBytes: number;
  usedBytes: number;
  locksOf: (segments: readonly string[]) => Lock[];
}

const ROOT_DISPLAY_NAME = "Cloud";

const SUPPORTED_LOCK =
  "<D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>";

/** The live properties; a function returns the element's inner XML, or undefined when the property does not exist for that resource. */
const LIVE: Record<string, (r: DavResource, c: PropContext) => string | undefined> = {
  resourcetype: (r) => (r.collection ? "<D:collection/>" : ""),
  displayname: (r) => escapeText(r.segments.at(-1) ?? ROOT_DISPLAY_NAME),
  getcontentlength: (r) => (r.collection ? undefined : String(r.size)),
  getcontenttype: (r) => (r.collection ? "httpd/unix-directory" : escapeText(r.mime)),
  getlastmodified: (r) => r.modified.toUTCString(),
  creationdate: (r) => r.created.toISOString(),
  getetag: (r) => (r.versionId === null ? undefined : `"${r.versionId}"`),
  supportedlock: () => SUPPORTED_LOCK,
  lockdiscovery: (r, c) => c.locksOf(r.segments).map(activeLockXml).join(""),
  "quota-available-bytes": (r, c) =>
    r.collection ? String(Math.max(0, c.quotaBytes - c.usedBytes)) : undefined,
  "quota-used-bytes": (r, c) => (r.collection ? String(c.usedBytes) : undefined),
};

const LIVE_NAMES = Object.keys(LIVE);

function element(prop: PropName, inner: string): string {
  const tag = prop.ns === DAV_NS ? `D:${prop.name}` : prop.name;
  const xmlns = prop.ns === DAV_NS ? "" : ` xmlns="${escapeAttribute(prop.ns)}"`;
  return inner === "" ? `<${tag}${xmlns}/>` : `<${tag}${xmlns}>${inner}</${tag}>`;
}

function propstat(props: string, status: string, error = ""): string {
  return `<D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 ${status}</D:status>${error}</D:propstat>`;
}

function response(resource: DavResource, body: string): string {
  const href = escapeText(hrefFor(resource.segments, resource.collection));
  return `<D:response><D:href>${href}</D:href>${body}</D:response>`;
}

export function multistatus(responses: readonly string[]): string {
  return `${XML_DECLARATION}<D:multistatus xmlns:D="DAV:">${responses.join("")}</D:multistatus>`;
}

/** One <D:response> answering a PROPFIND for one resource. */
export function propfindEntry(
  resource: DavResource,
  request: PropfindRequest,
  context: PropContext,
): string {
  const live = (name: string) => LIVE[name]?.(resource, context);
  if (request.kind === "prop") {
    const found: string[] = [];
    const missing: string[] = [];
    for (const prop of request.props) {
      const value = prop.ns === DAV_NS ? live(prop.name) : undefined;
      if (value === undefined) missing.push(element(prop, ""));
      else found.push(element(prop, value));
    }
    const parts: string[] = [];
    if (found.length > 0) parts.push(propstat(found.join(""), "200 OK"));
    if (missing.length > 0) parts.push(propstat(missing.join(""), "404 Not Found"));
    return response(resource, parts.join(""));
  }
  const names = LIVE_NAMES.filter((name) => live(name) !== undefined);
  const props = names
    .map((name) =>
      element({ ns: DAV_NS, name }, request.kind === "allprop" ? (live(name) ?? "") : ""),
    )
    .join("");
  return response(resource, propstat(props, "200 OK"));
}

/** PROPPATCH: every live property is read-only and there is no dead-property storage. */
export function proppatchEntry(resource: DavResource, props: readonly PropName[]): string {
  if (props.length === 0) return response(resource, "<D:status>HTTP/1.1 200 OK</D:status>");
  const rejected = props.map((p) => element(p, "")).join("");
  const error = "<D:error><D:cannot-modify-protected-property/></D:error>";
  return response(resource, propstat(rejected, "403 Forbidden", error));
}
