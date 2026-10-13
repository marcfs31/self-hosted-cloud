import request from "supertest";
import { expect } from "vitest";
import { createdAppPasswordResponse } from "@cloud/shared";
import { parseXml, type XmlElement } from "../dav/xml.js";
import { PASSWORD, binary, harness, type Harness } from "./harness.js";

type Verb = (url: string) => request.Test;
type Session = Awaited<ReturnType<Harness["admin"]>>;

/** supertest has a method for every verb Node knows, WebDAV's included; its types list only HTTP's. */
function verb(app: Harness["app"], method: string): Verb {
  const agent = request(app) as unknown as Record<string, Verb | undefined>;
  const fn = agent[method.toLowerCase()];
  if (!fn) throw new Error(`no supertest method ${method}`);
  return (url) => fn.call(agent, url);
}

export const XML_TYPE = "application/xml; charset=utf-8";

/** A WebDAV client authenticated with an app password. */
export function davClient(h: Harness, email: string, secret: string) {
  const basic = `Basic ${Buffer.from(`${email}:${secret}`).toString("base64")}`;
  const req = (method: string, path: string) =>
    verb(h.app, method)(path).set("Authorization", basic);
  return {
    req,
    options: (path = "/dav/") => req("OPTIONS", path),
    /** `depth` null sends no Depth header at all. */
    propfind(path: string, depth: string | null = "1", body?: string) {
      const r = req("PROPFIND", path).set("Content-Type", XML_TYPE);
      if (depth !== null) void r.set("Depth", depth);
      return body === undefined ? r : r.send(body);
    },
    proppatch: (path: string, body: string) =>
      req("PROPPATCH", path).set("Content-Type", XML_TYPE).send(body),
    put: (path: string, body: Buffer | string = "") =>
      req("PUT", path).set("Content-Type", "application/octet-stream").send(body),
    get: (path: string) => req("GET", path),
    bytes: (path: string) => binary(req("GET", path)),
    /** The body of a successful GET as UTF-8 text. */
    async text(path: string) {
      const res = await binary(req("GET", path));
      expect(res.status).toBe(200);
      return (res.body as Buffer).toString("utf8");
    },
    mkcol: (path: string) => req("MKCOL", path),
    del: (path: string) => req("DELETE", path),
    move: (path: string, to: string, overwrite?: "T" | "F") => {
      const r = req("MOVE", path).set("Destination", to);
      return overwrite ? r.set("Overwrite", overwrite) : r;
    },
    copy: (path: string, to: string, overwrite?: "T" | "F") => {
      const r = req("COPY", path).set("Destination", to);
      return overwrite ? r.set("Overwrite", overwrite) : r;
    },
    lock(path: string, opts: { timeout?: string; depth?: string } = {}) {
      const r = req("LOCK", path)
        .set("Content-Type", XML_TYPE)
        .send(
          '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope>' +
            "<D:locktype><D:write/></D:locktype><D:owner><D:href>mailto:me@example.com</D:href></D:owner></D:lockinfo>",
        );
      if (opts.timeout) void r.set("Timeout", opts.timeout);
      if (opts.depth) void r.set("Depth", opts.depth);
      return r;
    },
    unlock: (path: string, token: string) => req("UNLOCK", path).set("Lock-Token", `<${token}>`),
  };
}
export type DavClient = ReturnType<typeof davClient>;

/** Creates an app password for the session's user and returns a client that uses it. */
export async function davFor(h: Harness, s: Session): Promise<DavClient & { secret: string }> {
  const res = await s.post("/api/auth/app-passwords", { name: "webdav", password: PASSWORD });
  expect(res.status).toBe(201);
  const { token } = createdAppPasswordResponse.parse(res.body);
  return { ...davClient(h, s.email, token), secret: token };
}

export interface ParsedResponse {
  href: string;
  /** Property elements by status code, e.g. found[200].get("getetag"). */
  props: Map<number, Map<string, XmlElement>>;
  status: number | undefined;
}

/** The body of a supertest response as text, whatever its content type. */
export async function bodyText(r: request.Test): Promise<string> {
  const res = await binary(r);
  return Buffer.isBuffer(res.body) ? res.body.toString("utf8") : "";
}

function textOf(parent: XmlElement, name: string): string {
  return parent.children.find((c) => c.name === name)?.text ?? "";
}

export function parseMultistatus(text: string): ParsedResponse[] {
  const root = parseXml(text);
  expect(root.name).toBe("multistatus");
  return root.children
    .filter((c) => c.name === "response")
    .map((response) => {
      const props = new Map<number, Map<string, XmlElement>>();
      for (const stat of response.children.filter((c) => c.name === "propstat")) {
        const code = Number(/ (\d{3}) /.exec(textOf(stat, "status"))?.[1]);
        const bucket = props.get(code) ?? new Map<string, XmlElement>();
        const prop = stat.children.find((c) => c.name === "prop");
        for (const p of prop?.children ?? []) bucket.set(p.name, p);
        props.set(code, bucket);
      }
      const direct = /(\d{3})/.exec(textOf(response, "status"))?.[1];
      return {
        href: textOf(response, "href"),
        props,
        status: direct === undefined ? undefined : Number(direct),
      };
    });
}

export async function listing(r: request.Test): Promise<ParsedResponse[]> {
  const res = await binary(r);
  expect(res.status).toBe(207);
  return parseMultistatus((res.body as Buffer).toString("utf8"));
}

export function hrefs(entries: ParsedResponse[]): string[] {
  return entries.map((e) => e.href);
}

/** An admin (a) and a member (b), each with an app password and a WebDAV client. */
export async function davSetup() {
  const h = harness();
  const a = await h.admin("a@example.com");
  const b = await h.member("b@example.com");
  return { h, a, b, da: await davFor(h, a), dbb: await davFor(h, b) };
}
