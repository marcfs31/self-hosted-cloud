import { readdirSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { activity, changes, files } from "../db/schema/index.js";
import { bodyText, davSetup as setup, hrefs, listing } from "../testing/dav.js";

const HOST = "http://localhost:3000";

describe("WebDAV: MKCOL", () => {
  it("creates a collection, visible in the web API", async () => {
    const { a, da } = await setup();
    expect((await da.mkcol("/dav/Pictures")).status).toBe(201);
    expect((await da.mkcol("/dav/Pictures/2026/")).status).toBe(201);
    expect((await da.mkcol("/dav/Pictures/2026/")).status).toBe(405);
    expect((await da.mkcol("/dav/Nope/2026")).status).toBe(409);
    expect((await a.root()).children.map((c) => [c.name, c.kind])).toEqual([
      ["Pictures", "folder"],
    ]);
    const inner = await a.folder((await a.root()).children[0]?.id ?? "");
    expect(inner.children.map((c) => c.name)).toEqual(["2026"]);
  });

  it("is 405 for an existing name (file, folder or the root) and 409 without a parent", async () => {
    const { da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.put("/dav/file.txt", "x");
    expect((await da.mkcol("/dav/Dir")).status).toBe(405);
    expect((await da.mkcol("/dav/file.txt")).status).toBe(405);
    expect((await da.mkcol("/dav/")).status).toBe(405);
    expect((await da.mkcol("/dav/missing/child")).status).toBe(409);
    expect((await da.mkcol("/dav/file.txt/child")).status).toBe(409);
    await da.mkcol("/dav/Dir/Inner");
    expect(hrefs(await listing(da.propfind("/dav/Dir/", "1")))).toContain("/dav/Dir/Inner/");
  });

  it("is 415 when the request has a body", async () => {
    const { a, da } = await setup();
    const res = await da
      .req("MKCOL", "/dav/Body")
      .set("Content-Type", "application/xml")
      .send("<x/>");
    expect(res.status).toBe(415);
    expect((await a.root()).children).toHaveLength(0);
  });

  it("is 400 for a name the shared rules refuse", async () => {
    const { da } = await setup();
    expect((await da.mkcol("/dav/a%2Fb")).status).toBe(400);
    expect((await da.mkcol("/dav/a%5Cb")).status).toBe(400);
    expect((await da.mkcol("/dav/%00x")).status).toBe(400);
    expect((await da.mkcol("/dav/%20lead")).status).toBe(400);
    expect((await da.mkcol("/dav/..")).status).toBe(400);
    expect((await da.mkcol("/dav/%E0%A4%A")).status).toBe(400);
    expect((await da.mkcol(`/dav/${"x".repeat(256)}`)).status).toBe(400);
  });
});

describe("WebDAV: names", () => {
  it("rejects an encoded slash on every kind of write, and finds nothing under it on reads", async () => {
    const { a, da } = await setup();
    await da.mkcol("/dav/a");
    expect((await da.put("/dav/a%2Fb.txt", "x")).status).toBe(400);
    expect((await da.put("/dav/a/%2e%2e%2Fb.txt", "x")).status).toBe(400);
    expect((await da.get("/dav/a%2Fb.txt")).status).toBe(404);
    expect((await da.propfind("/dav/a%2Fb.txt", "0")).status).toBe(404);
    expect((await da.del("/dav/a%2Fb.txt")).status).toBe(404);
    await da.put("/dav/ok.txt", "x");
    expect((await da.move("/dav/ok.txt", `${HOST}/dav/x%2Fy.txt`)).status).toBe(400);
    expect((await da.copy("/dav/ok.txt", "/dav/x%5Cy.txt")).status).toBe(400);
    expect((await a.root()).children.map((c) => c.name).sort()).toEqual(["a", "ok.txt"]);
  });

  it("round-trips unicode names and normalises them to NFC", async () => {
    const { a, da } = await setup();
    const nfc = "café 日本語 🚀.txt";
    const nfd = "café 日本語 🚀.txt";
    expect((await da.put(`/dav/${encodeURIComponent(nfd)}`, "unicode")).status).toBe(201);
    expect((await a.root()).children[0]?.name).toBe(nfc);

    const entries = await listing(da.propfind("/dav/", "1"));
    expect(hrefs(entries)).toContain(`/dav/${encodeURIComponent(nfc)}`);
    const entry = entries.find((e) => e.href !== "/dav/");
    expect(entry?.props.get(200)?.get("displayname")?.text).toBe(nfc);
    expect(await da.text(`/dav/${encodeURIComponent(nfc)}`)).toBe("unicode");
    expect(await da.text(`/dav/${encodeURIComponent(nfd)}`)).toBe("unicode");
    // The same name in either form is the same file.
    expect((await da.put(`/dav/${encodeURIComponent(nfd)}`, "v2")).status).toBe(204);
  });

  it("keeps names out of filesystem paths", async () => {
    const { h, a, da } = await setup();
    await da.put("/dav/..%2F..%2Fescape.txt", "x");
    await da.put("/dav/passwd", "x");
    const [node] = (await a.root()).children;
    expect(node?.name).toBe("passwd");
    const stored = readdirSync(join(h.dataDir, "files", a.user.id), { recursive: true }).map(
      String,
    );
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((p) => p.split("/").every((part) => /^[0-9a-f-]{2,36}$/.test(part)))).toBe(
      true,
    );
    expect(readdirSync(h.dataDir)).not.toContain("escape.txt");
  });
});

describe("WebDAV: DELETE", () => {
  it("moves a file to the trash with activity and a change-feed row", async () => {
    const { h, a, da } = await setup();
    await da.put("/dav/gone.txt", "bye");
    const [node] = (await a.root()).children;
    const before = h.db
      .select()
      .from(changes)
      .where(eq(changes.fileId, node?.id ?? ""))
      .all().length;

    expect((await da.del("/dav/gone.txt")).status).toBe(204);
    expect((await a.root()).children).toHaveLength(0);
    expect((await da.get("/dav/gone.txt")).status).toBe(404);
    expect((await da.del("/dav/gone.txt")).status).toBe(404);

    const trash = (await a.get("/api/trash")).body as { items: { id: string; name: string }[] };
    expect(trash.items.map((i) => i.name)).toEqual(["gone.txt"]);
    const events = h.db
      .select()
      .from(activity)
      .where(and(eq(activity.type, "trash"), eq(activity.fileId, node?.id ?? "")))
      .all();
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]?.detail ?? "{}")).toMatchObject({
      name: "gone.txt",
      via: "webdav",
    });
    const after = h.db
      .select()
      .from(changes)
      .where(eq(changes.fileId, node?.id ?? ""))
      .all().length;
    expect(after).toBe(before + 1);
    // It can be restored through the API, bytes intact.
    expect((await a.post(`/api/trash/${node?.id}/restore`)).status).toBe(200);
    expect(await da.text("/dav/gone.txt")).toBe("bye");
  });

  it("trashes a collection with everything in it, and refuses the root", async () => {
    const { h, a, da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.mkcol("/dav/Dir/Sub");
    await da.put("/dav/Dir/Sub/deep.txt", "deep");
    const deep = h.db.select().from(files).where(eq(files.name, "deep.txt")).get();
    expect((await da.del("/dav/Dir/")).status).toBe(204);
    expect((await da.get("/dav/Dir/Sub/deep.txt")).status).toBe(404);
    expect((await da.propfind("/dav/Dir", "0")).status).toBe(404);
    const rows = h.db
      .select()
      .from(changes)
      .where(eq(changes.fileId, deep?.id ?? ""))
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect((await da.del("/dav/")).status).toBe(403);
    expect((await da.del("/dav")).status).toBe(403);
    expect((await a.root()).children).toHaveLength(0);
  });

  it("rejects a Depth other than infinity", async () => {
    const { da } = await setup();
    await da.put("/dav/x.txt", "x");
    expect((await da.del("/dav/x.txt").set("Depth", "0")).status).toBe(400);
    expect((await da.del("/dav/x.txt").set("Depth", "infinity")).status).toBe(204);
  });
});

describe("WebDAV: MOVE", () => {
  it("renames a file in place", async () => {
    const { a, da } = await setup();
    await da.put("/dav/old.txt", "content");
    const [before] = (await a.root()).children;
    const res = await da.move("/dav/old.txt", `${HOST}/dav/new%20name.txt`);
    expect(res.status).toBe(201);
    const [after] = (await a.root()).children;
    expect(after).toMatchObject({ id: before?.id, name: "new name.txt", versionCount: 1 });
    expect((await da.get("/dav/old.txt")).status).toBe(404);
    expect(await da.text("/dav/new%20name.txt")).toBe("content");
  });

  it("moves across folders, keeping a collection's contents, and records the change", async () => {
    const { h, a, da } = await setup();
    await da.mkcol("/dav/Src");
    await da.mkcol("/dav/Dst");
    await da.put("/dav/Src/f.txt", "f");
    await da.mkcol("/dav/Src/Inner");
    const inner = h.db.select().from(files).where(eq(files.name, "Inner")).get();
    const rowsBefore = h.db
      .select()
      .from(changes)
      .where(eq(changes.fileId, inner?.id ?? ""))
      .all().length;

    expect((await da.move("/dav/Src/f.txt", "/dav/Dst/f2.txt")).status).toBe(201);
    expect((await da.move("/dav/Src/", "/dav/Dst/Moved/")).status).toBe(201);
    expect(hrefs(await listing(da.propfind("/dav/Dst/", "1")))).toEqual([
      "/dav/Dst/",
      "/dav/Dst/Moved/",
      "/dav/Dst/f2.txt",
    ]);
    expect(hrefs(await listing(da.propfind("/dav/Dst/Moved/", "1")))).toEqual([
      "/dav/Dst/Moved/",
      "/dav/Dst/Moved/Inner/",
    ]);
    expect((await da.propfind("/dav/Src", "0")).status).toBe(404);
    const moved = h.db.select().from(files).where(eq(files.name, "Moved")).get();
    expect(
      h.db
        .select()
        .from(changes)
        .where(eq(changes.fileId, moved?.id ?? ""))
        .all().length,
    ).toBeGreaterThan(0);
    expect(rowsBefore).toBeGreaterThan(0);
    expect((await a.root()).children.map((c) => c.name)).toEqual(["Dst"]);
  });

  it("answers 412 for an existing destination with Overwrite: F and leaves both alone", async () => {
    const { da } = await setup();
    await da.put("/dav/a.txt", "A");
    await da.put("/dav/b.txt", "B");
    expect((await da.move("/dav/a.txt", "/dav/b.txt", "F")).status).toBe(412);
    expect(await da.text("/dav/a.txt")).toBe("A");
    expect(await da.text("/dav/b.txt")).toBe("B");
  });

  it("replaces an existing destination by default, sending it to the trash", async () => {
    const { a, da } = await setup();
    await da.put("/dav/a.txt", "A");
    await da.put("/dav/b.txt", "B");
    expect((await da.move("/dav/a.txt", "/dav/b.txt")).status).toBe(204);
    expect(await da.text("/dav/b.txt")).toBe("A");
    expect((await da.get("/dav/a.txt")).status).toBe(404);
    const trash = (await a.get("/api/trash")).body as { items: { name: string }[] };
    expect(trash.items.map((i) => i.name)).toEqual(["b.txt"]);
    expect((await da.move("/dav/b.txt", "/dav/c.txt", "T")).status).toBe(201);
  });

  it("refuses impossible moves", async () => {
    const { da } = await setup();
    await da.mkcol("/dav/Dir");
    await da.mkcol("/dav/Dir/Sub");
    await da.put("/dav/f.txt", "x");
    expect((await da.move("/dav/missing", "/dav/x")).status).toBe(404);
    expect((await da.move("/dav/f.txt", "/dav/f.txt")).status).toBe(403);
    expect((await da.move("/dav/Dir", "/dav/Dir/Sub/Dir")).status).toBe(403);
    expect((await da.move("/dav/Dir/Sub", "/dav/")).status).toBe(403);
    expect((await da.move("/dav/", "/dav/Root")).status).toBe(403);
    expect((await da.move("/dav/f.txt", "/dav/nope/f.txt")).status).toBe(409);
    expect((await da.move("/dav/f.txt", "/dav/Dir/Sub/")).status).toBe(204);
    expect((await da.req("MOVE", "/dav/Dir").send()).status).toBe(400);
    expect(
      (await da.req("MOVE", "/dav/Dir").set("Destination", "/dav/x").set("Overwrite", "maybe"))
        .status,
    ).toBe(400);
  });

  it("refuses another host and paths outside /dav", async () => {
    const { da } = await setup();
    await da.put("/dav/f.txt", "x");
    expect((await da.move("/dav/f.txt", "http://evil.example/dav/f.txt")).status).toBe(502);
    expect((await da.move("/dav/f.txt", `${HOST}/api/files`)).status).toBe(502);
    expect((await da.move("/dav/f.txt", "/elsewhere/f.txt")).status).toBe(502);
    expect((await da.move("/dav/f.txt", `${HOST}/dav/g.txt`)).status).toBe(201);
  });
});

describe("WebDAV: COPY", () => {
  it("copies a file as an independent file with one version", async () => {
    const { h, a, da } = await setup();
    await da.put("/dav/orig.txt", "v1");
    await da.put("/dav/orig.txt", "version two");
    const res = await da.copy("/dav/orig.txt", `${HOST}/dav/copy.txt`);
    expect(res.status).toBe(201);
    const nodes = (await a.root()).children;
    const orig = nodes.find((n) => n.name === "orig.txt");
    const copy = nodes.find((n) => n.name === "copy.txt");
    expect(orig).toMatchObject({ versionCount: 2, size: 11 });
    expect(copy).toMatchObject({ versionCount: 1, size: 11 });
    expect(copy?.id).not.toBe(orig?.id);
    expect(await da.text("/dav/copy.txt")).toBe("version two");

    await da.put("/dav/orig.txt", "changed");
    expect(await da.text("/dav/copy.txt")).toBe("version two");
    // Blobs are separate files.
    const copyVersion = (await a.get(`/api/files/${copy?.id}/versions`)).body as {
      versions: { id: string }[];
    };
    const origVersions = (await a.get(`/api/files/${orig?.id}/versions`)).body as {
      versions: { id: string }[];
    };
    expect(origVersions.versions.map((v) => v.id)).not.toContain(copyVersion.versions[0]?.id);
    expect(h.db.select().from(activity).where(eq(activity.type, "upload")).all().length).toBe(4);
    expect(readdirSync(join(h.dataDir, "tmp", "dav"))).toEqual([]);
  });

  it("copies a collection recursively, or only the collection with Depth: 0", async () => {
    const { a, da } = await setup();
    await da.mkcol("/dav/Album");
    await da.mkcol("/dav/Album/2026");
    await da.put("/dav/Album/a.txt", "A");
    await da.put("/dav/Album/2026/b.txt", "B");

    expect((await da.copy("/dav/Album/", "/dav/Backup/")).status).toBe(201);
    expect(hrefs(await listing(da.propfind("/dav/Backup/", "1")))).toEqual([
      "/dav/Backup/",
      "/dav/Backup/2026/",
      "/dav/Backup/a.txt",
    ]);
    expect(await da.text("/dav/Backup/2026/b.txt")).toBe("B");
    expect(await da.text("/dav/Album/2026/b.txt")).toBe("B");

    expect((await da.copy("/dav/Album", "/dav/Shell").set("Depth", "0")).status).toBe(201);
    expect(hrefs(await listing(da.propfind("/dav/Shell/", "1")))).toEqual(["/dav/Shell/"]);
    expect((await da.copy("/dav/Album", "/dav/Bad").set("Depth", "1")).status).toBe(400);
    expect((await a.root()).children.map((c) => c.name).sort()).toEqual([
      "Album",
      "Backup",
      "Shell",
    ]);
  });

  it("honours Overwrite and refuses copying into itself or onto an ancestor", async () => {
    const { a, da } = await setup();
    await da.put("/dav/a.txt", "A");
    await da.put("/dav/b.txt", "B");
    await da.mkcol("/dav/Dir");
    expect((await da.copy("/dav/a.txt", "/dav/b.txt", "F")).status).toBe(412);
    expect(await da.text("/dav/b.txt")).toBe("B");
    expect((await da.copy("/dav/a.txt", "/dav/b.txt")).status).toBe(204);
    expect(await da.text("/dav/b.txt")).toBe("A");
    expect((await da.copy("/dav/Dir", "/dav/Dir/Inside")).status).toBe(403);
    expect((await da.copy("/dav/a.txt", "/dav/a.txt")).status).toBe(403);
    expect((await da.copy("/dav/missing", "/dav/x")).status).toBe(404);
    expect((await da.copy("/dav/a.txt", "/dav/none/x")).status).toBe(409);
    const trash = (await a.get("/api/trash")).body as { items: { name: string }[] };
    expect(trash.items.map((i) => i.name)).toEqual(["b.txt"]);
  });

  it("answers 507 for a copy that does not fit the quota and changes nothing", async () => {
    const { h, a, da } = await setup();
    await da.mkcol("/dav/Big");
    await da.put("/dav/Big/one.bin", Buffer.alloc(400));
    await da.put("/dav/Big/two.bin", Buffer.alloc(400));
    h.setQuota(a.user.id, 1000);
    expect((await da.copy("/dav/Big", "/dav/Big2")).status).toBe(507);
    expect((await da.propfind("/dav/Big2", "0")).status).toBe(404);
    h.setQuota(a.user.id, 2000);
    expect((await da.copy("/dav/Big", "/dav/Big2")).status).toBe(201);
    expect(readdirSync(join(h.dataDir, "tmp", "dav"))).toEqual([]);
  });
});

describe("WebDAV: isolation between users", () => {
  it("gives every user their own root and never exposes another user's tree", async () => {
    const { a, b, da, dbb } = await setup();
    await da.mkcol("/dav/Private");
    await da.put("/dav/Private/secret.txt", "a-only");
    await da.put("/dav/shared-name.txt", "from A");

    expect(hrefs(await listing(dbb.propfind("/dav/", "1")))).toEqual(["/dav/"]);
    expect((await dbb.get("/dav/Private/secret.txt")).status).toBe(404);
    expect((await dbb.propfind("/dav/Private", "0")).status).toBe(404);
    expect((await dbb.del("/dav/Private")).status).toBe(404);
    expect((await dbb.move("/dav/Private", "/dav/Mine")).status).toBe(404);
    expect((await dbb.copy("/dav/shared-name.txt", "/dav/x.txt")).status).toBe(404);
    expect((await dbb.put("/dav/Private/x.txt", "b")).status).toBe(409);

    // The same name in B's root is a different file.
    expect((await dbb.put("/dav/shared-name.txt", "from B")).status).toBe(201);
    expect(await da.text("/dav/shared-name.txt")).toBe("from A");
    expect(await dbb.text("/dav/shared-name.txt")).toBe("from B");
    expect((await a.root()).children.map((c) => c.name).sort()).toEqual([
      "Private",
      "shared-name.txt",
    ]);
    expect((await b.root()).children.map((c) => c.name)).toEqual(["shared-name.txt"]);
  });

  it("does not let a Destination reach into another user's tree", async () => {
    const { b, da, dbb } = await setup();
    await da.mkcol("/dav/A-dir");
    await dbb.put("/dav/mine.txt", "b");
    // Destination names are resolved in the caller's own root, so this creates B's own folder path or fails.
    expect((await dbb.move("/dav/mine.txt", "/dav/A-dir/mine.txt")).status).toBe(409);
    expect((await b.root()).children.map((c) => c.name)).toEqual(["mine.txt"]);
  });
});

describe("WebDAV: the web API and WebDAV agree", () => {
  it("shows items trashed through the API as gone, and a restore as back", async () => {
    const { a, da } = await setup();
    await da.put("/dav/x.txt", "x");
    const [node] = (await a.root()).children;
    expect((await a.del(`/api/files/${node?.id}`)).status).toBe(204);
    expect((await da.get("/dav/x.txt")).status).toBe(404);
    // The name is free again.
    expect((await da.put("/dav/x.txt", "y")).status).toBe(201);
    expect(await bodyText(da.propfind("/dav/", "1"))).toContain("/dav/x.txt");
  });
});
