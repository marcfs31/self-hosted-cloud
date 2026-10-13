import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, utimesSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { appPasswordList, versionListing } from "@cloud/shared";
import { activity, changes } from "../db/schema/index.js";
import {
  bodyText,
  davClient,
  davSetup as setup,
  hrefs,
  listing,
  parseMultistatus,
} from "../testing/dav.js";
import { binary, blobFile, ORIGIN } from "../testing/harness.js";

const ALLPROP = '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
const PROPNAME = '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>';
const propRequest = (...names: string[]) =>
  `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop>${names.map((n) => `<D:${n}/>`).join("")}</D:prop></D:propfind>`;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function versionsOf(s: { get: (p: string) => request.Test }, id: string) {
  return versionListing.parse((await s.get(`/api/files/${id}/versions`)).body).versions;
}

describe("WebDAV: authentication", () => {
  it("challenges a request without credentials", async () => {
    const { h } = await setup();
    const plain = await request(h.app).get("/dav/");
    expect(plain.status).toBe(401);
    expect(plain.get("WWW-Authenticate")).toBe('Basic realm="Cloud", charset="UTF-8"');
    expect(plain.get("Set-Cookie")).toBeUndefined();
  });

  it("closes the connection when a request with a body is turned away", async () => {
    const { h } = await setup();
    const res = await request(h.app).put("/dav/x.txt").send("body");
    expect(res.status).toBe(401);
    expect(res.get("Connection")).toBe("close");
  });

  it("accepts the account email with an app password, and the app password as Bearer", async () => {
    const { h, a, da } = await setup();
    expect((await da.propfind("/dav/", "0")).status).toBe(207);
    const bearer = await da
      .req("PROPFIND", "/dav/")
      .set("Authorization", `Bearer ${da.secret}`)
      .set("Depth", "0");
    expect(bearer.status).toBe(207);
    const upper = davClient(h, a.email.toUpperCase(), da.secret);
    expect((await upper.propfind("/dav/", "0")).status).toBe(207);
  });

  it("refuses the account password, and a token under another account's email", async () => {
    const { h, a, da } = await setup();
    const account = davClient(h, a.email, "correct horse battery");
    const wrongPassword = await account.propfind("/dav/", "0");
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.get("WWW-Authenticate")).toContain("Basic");
    expect((await davClient(h, "b@example.com", da.secret).propfind("/dav/", "0")).status).toBe(
      401,
    );
    expect((await davClient(h, a.email, "").propfind("/dav/", "0")).status).toBe(401);
  });

  it("never accepts the cookie session, with or without credentials alongside", async () => {
    const { h, a, da } = await setup();
    const res = await request(h.app).get("/dav/").set("Cookie", a.cookie);
    expect(res.status).toBe(401);
    const put = await request(h.app)
      .put("/dav/x.txt")
      .set("Cookie", a.cookie)
      .set("Origin", ORIGIN)
      .send("data");
    expect(put.status).toBe(401);
    // A bad Basic header beside a valid cookie is still a failure: the cookie is not a fallback.
    const bad = await request(h.app)
      .get("/dav/")
      .set("Cookie", a.cookie)
      .set("Authorization", "Basic YTpi");
    expect(bad.status).toBe(401);
    expect((await a.root()).children).toHaveLength(0);
    // Valid credentials with a stray cookie work, and set no cookie.
    const ok = await da.propfind("/dav/", "0").set("Cookie", a.cookie);
    expect(ok.status).toBe(207);
    expect(ok.get("Set-Cookie")).toBeUndefined();
  });

  it("rate-limits failed Basic attempts per address and records use of the app password", async () => {
    const { h, a, da } = await setup();
    const wrong = davClient(h, a.email, "cloud_wrong");
    for (let i = 0; i < 5; i++) expect((await wrong.propfind("/dav/", "0")).status).toBe(401);
    const blocked = await wrong.propfind("/dav/", "0");
    expect(blocked.status).toBe(429);
    expect(blocked.get("Retry-After")).toBe("900");
    // The address is locked out, whoever it then claims to be.
    expect((await da.propfind("/dav/", "0")).status).toBe(429);
    h.clock.t += 16 * 60 * 1000;
    expect((await da.propfind("/dav/", "0")).status).toBe(207);

    const list = appPasswordList.parse((await a.get("/api/auth/app-passwords")).body);
    expect(list.appPasswords[0]?.lastUsedAt).not.toBeNull();
  });

  it("does not count the credential-less first request of a client as a failure", async () => {
    const { h, da } = await setup();
    for (let i = 0; i < 10; i++) expect((await request(h.app).get("/dav/")).status).toBe(401);
    expect((await da.propfind("/dav/", "0")).status).toBe(207);
  });

  it("stops working when the app password is revoked", async () => {
    const { a, da } = await setup();
    const list = appPasswordList.parse((await a.get("/api/auth/app-passwords")).body);
    const id = list.appPasswords[0]?.id ?? "";
    expect((await a.del(`/api/auth/app-passwords/${id}`)).status).toBe(204);
    expect((await da.propfind("/dav/", "0")).status).toBe(401);
  });
});

describe("WebDAV: OPTIONS and unsupported methods", () => {
  it("advertises class 1 and 2 and the supported methods", async () => {
    const { da } = await setup();
    const res = await da.options();
    expect(res.status).toBe(200);
    expect(res.get("DAV")).toBe("1, 2");
    expect(res.get("MS-Author-Via")).toBe("DAV");
    const allow = (res.get("Allow") ?? "").split(/,\s*/);
    expect(allow).toEqual(
      expect.arrayContaining([
        "OPTIONS",
        "GET",
        "HEAD",
        "PUT",
        "DELETE",
        "PROPFIND",
        "PROPPATCH",
        "MKCOL",
        "COPY",
        "MOVE",
        "LOCK",
        "UNLOCK",
      ]),
    );
    expect(allow).not.toContain("POST");
  });

  it("answers other methods with 405 and the Allow list", async () => {
    const { da } = await setup();
    const res = await da.req("POST", "/dav/x");
    expect(res.status).toBe(405);
    expect(res.get("Allow")).toContain("PROPFIND");
  });
});

describe("WebDAV: PROPFIND", () => {
  it("lists the root with depth 0 and 1, hrefs percent-encoded and collections slash-terminated", async () => {
    const { a, da } = await setup();
    const root = await a.root();
    await a.mkdir(root.folder.id, "My Folder");
    await da.put("/dav/hello world.txt", "hi");
    await da.put("/dav/ünï.txt", "yo");

    const zero = await listing(da.propfind("/dav/", "0"));
    expect(hrefs(zero)).toEqual(["/dav/"]);
    expect(zero[0]?.props.get(200)?.get("resourcetype")?.children[0]?.name).toBe("collection");

    const one = await listing(da.propfind("/dav", "1"));
    expect(new Set(hrefs(one))).toEqual(
      new Set(["/dav/", "/dav/My%20Folder/", "/dav/hello%20world.txt", "/dav/%C3%BCn%C3%AF.txt"]),
    );
    const file = one.find((e) => e.href === "/dav/hello%20world.txt");
    expect(file?.props.get(200)?.get("displayname")?.text).toBe("hello world.txt");
    expect(file?.props.get(200)?.get("getcontentlength")?.text).toBe("2");
    expect(file?.props.get(200)?.get("resourcetype")?.children).toHaveLength(0);
  });

  it("reports a folder's children and a file on its own", async () => {
    const { a, da } = await setup();
    const root = await a.root();
    const docs = await a.mkdir(root.folder.id, "Docs");
    await a.upload(docs.id, "a.txt", Buffer.from("alpha"));
    await a.mkdir(docs.id, "Sub");

    const inDocs = await listing(da.propfind("/dav/Docs/", "1"));
    expect(hrefs(inDocs)).toEqual(["/dav/Docs/", "/dav/Docs/Sub/", "/dav/Docs/a.txt"]);
    const file = await listing(da.propfind("/dav/Docs/a.txt", "1"));
    expect(hrefs(file)).toEqual(["/dav/Docs/a.txt"]);
    expect((await da.propfind("/dav/Docs/nope", "0")).status).toBe(404);
    expect((await da.propfind("/dav/Docs/a.txt/inside", "0")).status).toBe(404);
  });

  it("serves the live properties with correct formats", async () => {
    const { a, da } = await setup();
    const bytes = Buffer.from("0123456789");
    const root = await a.root();
    const id = await a.upload(root.folder.id, "digits.txt", bytes);
    const versions = await versionsOf(a, id);

    const [entry] = await listing(
      da.propfind(
        "/dav/digits.txt",
        "0",
        propRequest(
          "resourcetype",
          "displayname",
          "getcontentlength",
          "getcontenttype",
          "getlastmodified",
          "creationdate",
          "getetag",
          "supportedlock",
          "lockdiscovery",
          "quota-used-bytes",
        ),
      ),
    );
    const ok = entry?.props.get(200);
    expect(ok?.get("getcontentlength")?.text).toBe("10");
    expect(ok?.get("getcontenttype")?.text).toBe("text/plain");
    expect(ok?.get("getetag")?.text).toBe(`"${versions[0]?.id}"`);
    expect(ok?.get("getlastmodified")?.text).toMatch(
      /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
    );
    expect(Number.isNaN(Date.parse(ok?.get("creationdate")?.text ?? ""))).toBe(false);
    expect(ok?.get("supportedlock")?.children[0]?.name).toBe("lockentry");
    expect(ok?.get("lockdiscovery")?.children).toHaveLength(0);
    // Quota figures describe collections; on a file they do not exist.
    expect(entry?.props.get(404)?.has("quota-used-bytes")).toBe(true);
  });

  it("reports quota on collections", async () => {
    const { h, a, da } = await setup();
    h.setQuota(a.user.id, 1000);
    await da.put("/dav/f.bin", Buffer.alloc(300));
    const [entry] = await listing(
      da.propfind("/dav/", "0", propRequest("quota-available-bytes", "quota-used-bytes")),
    );
    expect(entry?.props.get(200)?.get("quota-used-bytes")?.text).toBe("300");
    expect(entry?.props.get(200)?.get("quota-available-bytes")?.text).toBe("700");
  });

  it("answers allprop (also for an empty body) and propname, and 404s unknown properties", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const names = (e: { props: Map<number, Map<string, unknown>> } | undefined) => [
      ...(e?.props.get(200)?.keys() ?? []),
    ];

    const [all] = await listing(da.propfind("/dav/a.txt", "0", ALLPROP));
    expect(names(all)).toEqual(
      expect.arrayContaining(["resourcetype", "getetag", "getcontentlength", "getlastmodified"]),
    );
    const [noBody] = await listing(da.propfind("/dav/a.txt", "0"));
    expect(names(noBody)).toEqual(names(all));

    const [propname] = await listing(da.propfind("/dav/a.txt", "0", PROPNAME));
    expect(names(propname)).toEqual(names(all));
    expect(propname?.props.get(200)?.get("getetag")?.text).toBe("");

    const custom =
      '<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:"><D:prop><D:getetag/><Z:Win32FileAttributes/></D:prop></D:propfind>';
    const res = await binary(da.propfind("/dav/a.txt", "0", custom));
    const [entry] = parseMultistatus((res.body as Buffer).toString("utf8"));
    expect(entry?.props.get(200)?.has("getetag")).toBe(true);
    expect(entry?.props.get(404)?.get("Win32FileAttributes")?.ns).toBe(
      "urn:schemas-microsoft-com:",
    );
  });

  it("refuses Depth: infinity, and a missing Depth, with the finite-depth precondition", async () => {
    const { da } = await setup();
    for (const depth of ["infinity", null]) {
      const res = await da.propfind("/dav/", depth);
      expect(res.status).toBe(403);
      expect(await bodyText(da.propfind("/dav/", depth))).toContain("propfind-finite-depth");
    }
    expect((await da.propfind("/dav/", "2")).status).toBe(400);
  });

  it("rejects DOCTYPE and entities, malformed XML, a wrong root and oversized bodies", async () => {
    const { da } = await setup();
    const xxe =
      '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><D:propfind xmlns:D="DAV:"><D:prop><D:displayname>&xxe;</D:displayname></D:prop></D:propfind>';
    expect((await da.propfind("/dav/", "0", xxe)).status).toBe(400);
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY a "aaaa">]><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
    expect((await da.propfind("/dav/", "0", bomb)).status).toBe(400);
    expect((await da.propfind("/dav/", "0", "<D:propfind")).status).toBe(400);
    expect((await da.propfind("/dav/", "0", '<a xmlns="x"/>')).status).toBe(400);
    const big = `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/><!--${"x".repeat(70_000)}--></D:propfind>`;
    expect((await da.propfind("/dav/", "0", big)).status).toBe(413);
    // Still healthy afterwards.
    expect((await da.propfind("/dav/", "0", ALLPROP)).status).toBe(207);
  });

  it("bounds how many properties one request may ask for", async () => {
    const { da } = await setup();
    const many = Array.from({ length: 65 }, (_, i) => `p${i}`);
    expect((await da.propfind("/dav/", "0", propRequest(...many))).status).toBe(400);
    expect((await da.propfind("/dav/", "0", propRequest(...many.slice(1)))).status).toBe(207);
  });

  it("escapes names in the response", async () => {
    const { da } = await setup();
    await da.put("/dav/a&b%3Cc%3E.txt", "x");
    const text = await bodyText(da.propfind("/dav/", "1"));
    expect(text).toContain("a&amp;b&lt;c&gt;.txt");
    expect(text).toContain("/dav/a%26b%3Cc%3E.txt");
    expect(() => parseMultistatus(text)).not.toThrow();
  });
});

describe("WebDAV: PROPPATCH", () => {
  it("answers 207 with 403 for each property instead of failing", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "x");
    const body =
      '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:"><D:set><D:prop><Z:Win32LastModifiedTime>x</Z:Win32LastModifiedTime><D:getlastmodified>y</D:getlastmodified></D:prop></D:set><D:remove><D:prop><Z:Foo/></D:prop></D:remove></D:propertyupdate>';
    const res = await da.proppatch("/dav/a.txt", body);
    expect(res.status).toBe(207);
    const [entry] = parseMultistatus(
      await bodyText(
        da.req("PROPPATCH", "/dav/a.txt").set("Content-Type", "application/xml").send(body),
      ),
    );
    expect(entry?.href).toBe("/dav/a.txt");
    expect([...(entry?.props.get(403)?.keys() ?? [])]).toEqual([
      "Win32LastModifiedTime",
      "getlastmodified",
      "Foo",
    ]);
    expect((await da.proppatch("/dav/missing", body)).status).toBe(404);
    expect((await da.proppatch("/dav/a.txt", "<garbage")).status).toBe(400);
  });
});

describe("WebDAV: GET, HEAD and PUT", () => {
  it("PUT creates a file that GET returns byte for byte, and the web API sees it", async () => {
    const { h, a, da } = await setup();
    const bytes = randomBytes(300_000);
    const put = await da.put("/dav/photo.png", bytes);
    expect(put.status).toBe(201);
    expect(put.get("ETag")).toMatch(/^"[0-9a-f-]{36}"$/);

    const got = await da.bytes("/dav/photo.png");
    expect(got.status).toBe(200);
    expect(got.body).toEqual(bytes);
    expect(got.get("ETag")).toBe(put.get("ETag"));
    expect(got.get("Content-Length")).toBe(String(bytes.length));

    const listed = (await a.root()).children;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: "photo.png",
      size: bytes.length,
      mime: "image/png",
      versionCount: 1,
    });
    const versions = await versionsOf(a, listed[0]?.id ?? "");
    expect(versions[0]?.sha256).toBe(sha(bytes));
    expect(blobFile(h.dataDir, a.user.id, versions[0]?.id ?? "")).not.toContain("photo");
    expect(existsSync(blobFile(h.dataDir, a.user.id, versions[0]?.id ?? ""))).toBe(true);
    expect(readdirSync(join(h.dataDir, "tmp", "dav"))).toEqual([]);

    const head = await da.req("HEAD", "/dav/photo.png");
    expect(head.status).toBe(200);
    expect(head.get("Content-Length")).toBe(String(bytes.length));
    expect(head.get("Last-Modified")).toMatch(/GMT$/);
  });

  it("serves ranges and conditional requests", async () => {
    const { da } = await setup();
    const bytes = Buffer.from("abcdefghij");
    const put = await da.put("/dav/r.txt", bytes);
    const range = await binary(da.get("/dav/r.txt").set("Range", "bytes=2-4"));
    expect(range.status).toBe(206);
    expect((range.body as Buffer).toString()).toBe("cde");
    const cached = await da.get("/dav/r.txt").set("If-None-Match", put.get("ETag") ?? "");
    expect(cached.status).toBe(304);
  });

  it("PUT over an existing file adds a version", async () => {
    const { a, da } = await setup();
    expect((await da.put("/dav/doc.txt", "one")).status).toBe(201);
    const second = await da.put("/dav/doc.txt", "two!!");
    expect(second.status).toBe(204);
    const [node] = (await a.root()).children;
    expect(node).toMatchObject({ name: "doc.txt", size: 5, versionCount: 2 });
    expect(await da.text("/dav/doc.txt")).toBe("two!!");
    const versions = await versionsOf(a, node?.id ?? "");
    expect(versions.map((v) => v.size).sort()).toEqual([3, 5]);
  });

  it("PUT creates an empty file", async () => {
    const { a, da } = await setup();
    expect((await da.put("/dav/empty.txt", "")).status).toBe(201);
    expect((await a.root()).children[0]).toMatchObject({ name: "empty.txt", size: 0 });
    expect((await da.bytes("/dav/empty.txt")).body).toHaveLength(0);
  });

  it("PUT into a missing or non-folder parent is 409, onto a collection 405, onto the root 405", async () => {
    const { h, a, da } = await setup();
    expect((await da.put("/dav/nope/file.txt", "x")).status).toBe(409);
    await da.put("/dav/plain.txt", "x");
    expect((await da.put("/dav/plain.txt/inside.txt", "x")).status).toBe(409);
    const root = await a.root();
    await a.mkdir(root.folder.id, "Dir");
    expect((await da.put("/dav/Dir", "x")).status).toBe(405);
    expect((await da.put("/dav/", "x")).status).toBe(405);
    expect(
      (await da.req("PUT", "/dav/c.txt").set("Content-Range", "bytes 0-1/2").send("ab")).status,
    ).toBe(400);
    expect(readdirSync(join(h.dataDir, "tmp", "dav"))).toEqual([]);
  });

  it("honours If-Match and If-None-Match on PUT", async () => {
    const { da } = await setup();
    const first = await da.put("/dav/c.txt", "one");
    expect((await da.req("PUT", "/dav/c.txt").set("If-None-Match", "*").send("x")).status).toBe(
      412,
    );
    expect((await da.req("PUT", "/dav/new.txt").set("If-None-Match", "*").send("x")).status).toBe(
      201,
    );
    expect((await da.req("PUT", "/dav/c.txt").set("If-Match", '"other"').send("x")).status).toBe(
      412,
    );
    expect((await da.req("PUT", "/dav/gone.txt").set("If-Match", "*").send("x")).status).toBe(412);
    const ok = await da
      .req("PUT", "/dav/c.txt")
      .set("If-Match", first.get("ETag") ?? "")
      .send("two");
    expect(ok.status).toBe(204);
  });

  it("answers 507 over quota, before the body for a declared length and while streaming otherwise", async () => {
    const { h, a, da } = await setup();
    h.setQuota(a.user.id, 100);
    const declared = await da.put("/dav/big.bin", Buffer.alloc(200));
    expect(declared.status).toBe(507);
    expect((await a.root()).children).toHaveLength(0);
    expect((await da.put("/dav/ok.bin", Buffer.alloc(100))).status).toBe(201);
    // Versions count: a replacement does not fit either.
    expect((await da.put("/dav/ok.bin", Buffer.alloc(1))).status).toBe(507);

    // No Content-Length: the limit is enforced as the bytes arrive.
    h.setQuota(a.user.id, 150);
    const server = h.app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            port,
            method: "PUT",
            path: "/dav/streamed.bin",
            headers: {
              Authorization: `Basic ${Buffer.from(`${a.email}:${da.secret}`).toString("base64")}`,
              "Transfer-Encoding": "chunked",
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.write(Buffer.alloc(40));
        req.write(Buffer.alloc(40));
        req.end(Buffer.alloc(40));
      });
      expect(status).toBe(507);
    } finally {
      server.close();
    }
    expect((await a.root()).children.map((c) => c.name)).toEqual(["ok.bin"]);
    expect(readdirSync(join(h.dataDir, "tmp", "dav"))).toEqual([]);
  });

  it("removes the temp file when the client hangs up mid-upload", async () => {
    const { h, a, da } = await setup();
    const server = h.app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      await new Promise<void>((resolve) => {
        const req = http.request({
          port,
          method: "PUT",
          path: "/dav/half.bin",
          headers: {
            Authorization: `Basic ${Buffer.from(`${a.email}:${da.secret}`).toString("base64")}`,
            "Content-Length": "1000",
          },
        });
        req.on("error", () => undefined);
        req.write(Buffer.alloc(100), () => {
          setTimeout(() => {
            req.destroy();
            resolve();
          }, 50);
        });
      });
      const dir = join(h.dataDir, "tmp", "dav");
      for (let i = 0; i < 40 && readdirSync(dir).length > 0; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      server.close();
    }
    expect((await a.root()).children).toHaveLength(0);
  });

  it("records an 'upload' activity event and a change-feed row", async () => {
    const { h, a, da } = await setup();
    await da.put("/dav/log.txt", "x");
    const [node] = (await a.root()).children;
    const events = h.db.select().from(activity).where(eq(activity.type, "upload")).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: a.user.id, fileId: node?.id });
    expect(JSON.parse(events[0]?.detail ?? "{}")).toEqual({
      name: "log.txt",
      kind: "file",
      via: "webdav",
    });
    const rows = h.db
      .select()
      .from(changes)
      .where(eq(changes.fileId, node?.id ?? ""))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("GET on a collection is 405 and on a missing file 404", async () => {
    const { da } = await setup();
    expect((await da.get("/dav/")).status).toBe(405);
    expect((await da.get("/dav/missing.txt")).status).toBe(404);
  });

  it("sweeps stale temp files with the hourly cleanup", async () => {
    const { h } = await setup();
    const dir = join(h.dataDir, "tmp", "dav");
    mkdirSync(dir, { recursive: true });
    const stale = join(dir, crypto.randomUUID());
    const fresh = join(dir, crypto.randomUUID());
    writeFileSync(stale, "x");
    writeFileSync(fresh, "x");
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    h.clock.t = Date.now();
    await h.app.cleanUpUploads();
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});
