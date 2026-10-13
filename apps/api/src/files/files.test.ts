import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  errorResponse,
  fileNode,
  trashListing,
  usageResponse,
  versionListing,
  type FileNode,
} from "@cloud/shared";
import { eq } from "drizzle-orm";
import { files, fileVersions } from "../db/schema/index.js";
import { binary, blobFile, harness, type Harness } from "../testing/harness.js";
import { purgeExpiredTrash } from "./trash.js";

const DAY = 24 * 60 * 60 * 1000;

function errorCode(res: { body: unknown }): string {
  return errorResponse.parse(res.body).error.code;
}

async function twoUsers(h: Harness) {
  const admin = await h.admin();
  const other = await h.member("b@example.com");
  return { a: admin, b: other };
}

async function versionsOf(a: Awaited<ReturnType<Harness["admin"]>>, fileId: string) {
  const res = await a.get(`/api/files/${fileId}/versions`);
  expect(res.status).toBe(200);
  return versionListing.parse(res.body).versions;
}

describe("folders and names", () => {
  it("creates the root on first use and returns the same one afterwards", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const first = await a.root();
    expect(first.folder).toMatchObject({
      parentId: null,
      name: "",
      kind: "folder",
      versionCount: 0,
    });
    expect(first.breadcrumbs).toEqual([{ id: first.folder.id, name: "" }]);
    expect((await a.root()).folder.id).toBe(first.folder.id);
  });

  it("requires a session on every files endpoint", async () => {
    const h = harness();
    await h.admin();
    const anon = h.app;
    const { default: request } = await import("supertest");
    for (const path of ["/api/files/root", "/api/usage", "/api/trash", "/api/folders/x"]) {
      const res = await request(anon).get(path);
      expect(res.status, path).toBe(401);
      expect(errorCode(res)).toBe("unauthenticated");
    }
  });

  it("rejects invalid names with 400 and normalises to NFC", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    for (const name of [
      "a/b",
      "a\\b",
      "a\u0001b",
      "a\u007fb",
      ".",
      "..",
      "x".repeat(256),
      "",
      " pad",
    ]) {
      const res = await a.post("/api/folders", { parentId: root.id, name });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(errorCode(res)).toBe("invalid_request");
    }
    const decomposed = await a.mkdir(root.id, "école");
    expect(decomposed.name).toBe("école");
    const again = await a.post("/api/folders", { parentId: root.id, name: "école" });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe("name_conflict");
    const longest = await a.post("/api/folders", { parentId: root.id, name: "y".repeat(255) });
    expect(longest.status).toBe(201);
  });

  it("answers name_conflict on create and on rename", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const docs = await a.mkdir(root.id, "docs");
    await a.mkdir(root.id, "pics");
    const dupe = await a.post("/api/folders", { parentId: root.id, name: "docs" });
    expect(dupe.status).toBe(409);
    expect(errorCode(dupe)).toBe("name_conflict");
    const rename = await a.patch(`/api/files/${docs.id}`, { name: "pics" });
    expect(rename.status).toBe(409);
    expect(errorCode(rename)).toBe("name_conflict");
    const same = await a.patch(`/api/files/${docs.id}`, { name: "docs" });
    expect(same.status).toBe(200);
  });

  it("lists folders first, then files, each by case-insensitive name, with breadcrumbs", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const b = await a.mkdir(root.id, "b");
    await a.mkdir(root.id, "A");
    await a.mkdir(root.id, "c");
    await a.upload(root.id, "z.txt", Buffer.from("z"));
    await a.upload(root.id, "Y.txt", Buffer.from("y"));
    await a.upload(root.id, "a.txt", Buffer.from("a"));
    const listing = await a.folder(root.id);
    expect(listing.children.map((c) => c.name)).toEqual(["A", "b", "c", "a.txt", "Y.txt", "z.txt"]);
    const child = await a.mkdir(b.id, "inner");
    expect((await a.folder(child.id)).breadcrumbs.map((c) => c.name)).toEqual(["", "b", "inner"]);
  });

  it("renames and moves, and refuses moves into itself or a descendant", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const top = await a.mkdir(root.id, "top");
    const mid = await a.mkdir(top.id, "mid");
    const leaf = await a.mkdir(mid.id, "leaf");
    const fileId = await a.upload(root.id, "f.txt", Buffer.from("x"));

    const renamed = await a.patch(`/api/files/${fileId}`, { name: "g.txt" });
    expect(fileNode.parse(renamed.body)).toMatchObject({ name: "g.txt", parentId: root.id });
    const moved = await a.patch(`/api/files/${fileId}`, { parentId: leaf.id });
    expect(fileNode.parse(moved.body)).toMatchObject({ name: "g.txt", parentId: leaf.id });
    expect((await a.folder(leaf.id)).children.map((c) => c.name)).toEqual(["g.txt"]);

    for (const target of [top.id, mid.id, leaf.id]) {
      const res = await a.patch(`/api/files/${top.id}`, { parentId: target });
      expect(res.status, target).toBe(409);
      expect(errorCode(res)).toBe("invalid_move");
    }
    const ok = await a.patch(`/api/files/${leaf.id}`, { parentId: root.id });
    expect(ok.status).toBe(200);
    const intoFile = await a.patch(`/api/files/${leaf.id}`, { parentId: fileId });
    expect(intoFile.status).toBe(404);
    const empty = await a.patch(`/api/files/${leaf.id}`, {});
    expect(empty.status).toBe(400);
  });

  it("refuses to rename, move or trash the root", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const other = await a.mkdir(root.id, "other");
    for (const res of [
      await a.patch(`/api/files/${root.id}`, { name: "x" }),
      await a.patch(`/api/files/${root.id}`, { parentId: other.id }),
      await a.del(`/api/files/${root.id}`),
    ]) {
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe("invalid_move");
    }
  });
});

describe("trash", () => {
  it("makes a trashed folder's subtree inactive without marking the children", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const dir = await a.mkdir(root.id, "dir");
    const sub = await a.mkdir(dir.id, "sub");
    const fileId = await a.upload(sub.id, "deep.txt", Buffer.from("deep"));
    expect((await a.get(`/api/files/${fileId}/content`)).status).toBe(200);

    expect((await a.del(`/api/files/${dir.id}`)).status).toBe(204);

    expect((await a.get(`/api/files/${fileId}/content`)).status).toBe(404);
    expect((await a.get(`/api/files/${fileId}/versions`)).status).toBe(404);
    expect((await a.get(`/api/folders/${dir.id}`)).status).toBe(404);
    expect((await a.get(`/api/folders/${sub.id}`)).status).toBe(404);
    expect((await a.patch(`/api/files/${fileId}`, { name: "x.txt" })).status).toBe(404);
    expect((await a.del(`/api/files/${fileId}`)).status).toBe(404);
    expect((await a.patch(`/api/files/${sub.id}`, { parentId: root.id })).status).toBe(404);
    expect((await a.post("/api/folders", { parentId: sub.id, name: "no" })).status).toBe(404);
    expect((await a.root()).children).toEqual([]);
    expect((await a.post(`/api/trash/${sub.id}/restore`)).status).toBe(404);

    const listed = trashListing.parse((await a.get("/api/trash")).body);
    expect(listed.items.map((i) => i.id)).toEqual([dir.id]);
    expect(listed.items[0]?.deletedAt).not.toBeNull();

    const restored = await a.post(`/api/trash/${dir.id}/restore`);
    expect(fileNode.parse(restored.body)).toMatchObject({
      name: "dir",
      parentId: root.id,
      deletedAt: null,
    });
    expect((await a.get(`/api/files/${fileId}/content`)).status).toBe(200);
  });

  it("lists the most recently trashed first", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const first = await a.mkdir(root.id, "first");
    const second = await a.mkdir(root.id, "second");
    await a.del(`/api/files/${first.id}`);
    h.clock.t += 1000;
    await a.del(`/api/files/${second.id}`);
    const listed = trashListing.parse((await a.get("/api/trash")).body);
    expect(listed.items.map((i) => i.name)).toEqual(["second", "first"]);
  });

  it("restores into the root when the original parent is trashed, and renames a taken name", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const parent = await a.mkdir(root.id, "parent");
    const child = await a.mkdir(parent.id, "child");
    await a.del(`/api/files/${child.id}`);
    await a.del(`/api/files/${parent.id}`);
    await a.mkdir(root.id, "child");

    const restored = fileNode.parse((await a.post(`/api/trash/${child.id}/restore`)).body);
    expect(restored).toMatchObject({ name: "child (1)", parentId: root.id });
    expect((await a.folder(root.id)).children.map((c) => c.name)).toEqual(["child", "child (1)"]);

    const intoLive = await a.mkdir(root.id, "live");
    const doc = await a.upload(intoLive.id, "doc.txt", Buffer.from("1"));
    await a.del(`/api/files/${doc}`);
    await a.upload(intoLive.id, "doc.txt", Buffer.from("2"));
    const back = fileNode.parse((await a.post(`/api/trash/${doc}/restore`)).body);
    expect(back).toMatchObject({ name: "doc (1).txt", parentId: intoLive.id });
  });

  it("purges a subtree: rows and every version blob, in one call, and frees the quota", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const dir = await a.mkdir(root.id, "dir");
    const inner = await a.mkdir(dir.id, "inner");
    const f1 = await a.upload(dir.id, "one.txt", Buffer.from("one"));
    const f2 = await a.upload(inner.id, "two.txt", Buffer.from("twotwo"));
    await a.upload(inner.id, "two.txt", Buffer.from("three!"), f2);
    const keep = await a.upload(root.id, "keep.txt", Buffer.from("keep"));
    const versionIds = h.db
      .select({ id: fileVersions.id })
      .from(fileVersions)
      .all()
      .map((v) => v.id);
    expect(versionIds).toHaveLength(4);
    for (const id of versionIds) expect(existsSync(blobFile(h.dataDir, a.user.id, id))).toBe(true);
    const keepVersion =
      h.db.select().from(files).where(eq(files.id, keep)).get()?.currentVersionId ?? "";

    await a.del(`/api/files/${dir.id}`);
    expect((await a.del(`/api/trash/${f1}`)).status).toBe(404); // not a top-level trashed item
    expect((await a.del(`/api/trash/${dir.id}`)).status).toBe(204);

    for (const id of versionIds.filter((v) => v !== keepVersion)) {
      expect(existsSync(blobFile(h.dataDir, a.user.id, id)), id).toBe(false);
    }
    expect(existsSync(blobFile(h.dataDir, a.user.id, keepVersion))).toBe(true);
    expect(h.db.select().from(files).where(eq(files.id, inner.id)).all()).toEqual([]);
    expect(h.db.select().from(fileVersions).all()).toHaveLength(1);
    expect((await a.get("/api/trash")).body).toEqual({ items: [], retentionDays: 30 });
    expect(usageResponse.parse((await a.get("/api/usage")).body).usedBytes).toBe(4);
  });

  it("logs a failed unlink and never resurrects the purged row", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const stuck = await a.upload(root.id, "stuck.txt", Buffer.from("stuck"));
    const [version] = await versionsOf(a, stuck);
    const path = blobFile(h.dataDir, a.user.id, version?.id ?? "");
    // A directory with content at the blob path makes unlink fail with EISDIR/EPERM.
    rmSync(path);
    mkdirSync(join(path, "child"), { recursive: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await a.del(`/api/files/${stuck}`);
    expect((await a.del(`/api/trash/${stuck}`)).status).toBe(204);

    expect(logged).toHaveBeenCalledWith("blob unlink failed:", expect.any(String));
    logged.mockRestore();
    expect(h.db.select().from(files).where(eq(files.id, stuck)).all()).toEqual([]);
    expect(h.db.select().from(fileVersions).all()).toEqual([]);
  });

  it("empties the trash", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const x = await a.upload(root.id, "x.txt", Buffer.from("x"));
    const d = await a.mkdir(root.id, "d");
    const y = await a.upload(d.id, "y.txt", Buffer.from("yy"));
    await a.del(`/api/files/${y}`);
    await a.del(`/api/files/${x}`);
    await a.del(`/api/files/${d.id}`);
    expect((await a.del("/api/trash")).status).toBe(204);
    expect(h.db.select().from(fileVersions).all()).toEqual([]);
    expect(usageResponse.parse((await a.get("/api/usage")).body).usedBytes).toBe(0);
  });

  it("sweeps only items trashed more than 30 days ago", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const old = await a.upload(root.id, "old.txt", Buffer.from("old"));
    const recent = await a.upload(root.id, "recent.txt", Buffer.from("recent"));
    const edge = await a.upload(root.id, "edge.txt", Buffer.from("edge"));
    const now = h.clock.t;
    h.clock.t = now - 31 * DAY;
    await a.del(`/api/files/${old}`);
    h.clock.t = now - 29 * DAY;
    await a.del(`/api/files/${recent}`);
    h.clock.t = now - 30 * DAY + 1000;
    await a.del(`/api/files/${edge}`);
    h.clock.t = now;

    const purged = await purgeExpiredTrash({ db: h.db, dataDir: h.dataDir, now: () => h.clock.t });
    expect(purged).toBe(1);
    const left = trashListing.parse((await a.get("/api/trash")).body).items.map((i) => i.name);
    expect(left).toEqual(["recent.txt", "edge.txt"]);
    expect(h.db.select().from(fileVersions).all()).toHaveLength(2);
  });
});

describe("version history", () => {
  it("names a repeated upload 'a (1).txt' and adds a version when replacing", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const first = await a.upload(root.id, "a.txt", Buffer.from("one"));
    const second = await a.upload(root.id, "a.txt", Buffer.from("two"));
    expect(second).not.toBe(first);
    expect((await a.folder(root.id)).children.map((c) => c.name)).toEqual(["a (1).txt", "a.txt"]);

    const replaced = await a.upload(root.id, "whatever.txt", Buffer.from("three"), first);
    expect(replaced).toBe(first);
    const node = (await a.folder(root.id)).children.find((c) => c.id === first) as FileNode;
    expect(node).toMatchObject({ name: "a.txt", versionCount: 2, size: 5, mime: "text/plain" });
    const content = await binary(a.get(`/api/files/${first}/content`));
    expect(content.body).toEqual(Buffer.from("three"));
  });

  it("restores an old version, refuses to delete the current one and removes old blobs", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const fileId = await a.upload(root.id, "v.txt", Buffer.from("v1-bytes"));
    await a.upload(root.id, "v.txt", Buffer.from("v2-bytes!"), fileId);

    const [v2, v1] = await versionsOf(a, fileId);
    expect(v2).toMatchObject({ current: true, size: 9 });
    expect(v1).toMatchObject({
      current: false,
      size: 8,
      mime: "text/plain",
      sha256: createHash("sha256").update("v1-bytes").digest("hex"),
    });
    if (!v1 || !v2) throw new Error("expected two versions");

    const old = await binary(a.get(`/api/files/${fileId}/versions/${v1.id}/content`));
    expect(old.body).toEqual(Buffer.from("v1-bytes"));

    const restored = await a.post(`/api/files/${fileId}/versions/${v1.id}/restore`);
    expect(fileNode.parse(restored.body)).toMatchObject({
      currentVersionId: v1.id,
      versionCount: 2,
      size: 8,
    });
    expect((await binary(a.get(`/api/files/${fileId}/content`))).body).toEqual(
      Buffer.from("v1-bytes"),
    );
    expect((await versionsOf(a, fileId)).map((v) => v.current)).toEqual([false, true]);

    const refused = await a.del(`/api/files/${fileId}/versions/${v1.id}`);
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe("version_is_current");
    expect(existsSync(blobFile(h.dataDir, a.user.id, v1.id))).toBe(true);

    expect((await a.del(`/api/files/${fileId}/versions/${v2.id}`)).status).toBe(204);
    expect(existsSync(blobFile(h.dataDir, a.user.id, v2.id))).toBe(false);
    expect((await versionsOf(a, fileId)).map((v) => v.id)).toEqual([v1.id]);
    expect((await a.get(`/api/files/${fileId}/versions/${v2.id}/content`)).status).toBe(404);
    expect(usageResponse.parse((await a.get("/api/usage")).body).usedBytes).toBe(8);
  });

  it("keeps blobs under ids only: the file name never appears in the path", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const fileId = await a.upload(root.id, "secret-name.txt", Buffer.from("x"));
    const [version] = await versionsOf(a, fileId);
    const path = blobFile(h.dataDir, a.user.id, version?.id ?? "");
    expect(existsSync(path)).toBe(true);
    expect(path).not.toContain("secret-name");
    const { execFileSync } = await import("node:child_process");
    const everything = execFileSync("find", [h.dataDir]).toString();
    expect(everything).not.toContain("secret-name");
  });
});

describe("content headers", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  it("serves safe types inline and everything else as an octet-stream attachment", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const pic = await a.upload(root.id, "pic.png", png);
    const html = await a.upload(root.id, "page.html", Buffer.from("<script>alert(1)</script>"));
    const svg = await a.upload(root.id, "vec.svg", Buffer.from("<svg onload=alert(1)/>"));

    const inline = await binary(a.get(`/api/files/${pic}/content`));
    expect(inline.status).toBe(200);
    expect(inline.get("Content-Type")).toBe("image/png");
    expect(inline.get("Content-Disposition")).toMatch(/^inline;/);
    expect(inline.body).toEqual(png);

    for (const id of [html, svg]) {
      const res = await binary(a.get(`/api/files/${id}/content`));
      expect(res.get("Content-Type")).toBe("application/octet-stream");
      expect(res.get("Content-Disposition")).toMatch(/^attachment;/);
    }
    const forced = await binary(a.get(`/api/files/${pic}/content?download=1`));
    expect(forced.get("Content-Type")).toBe("application/octet-stream");
    expect(forced.get("Content-Disposition")).toMatch(/^attachment;/);

    for (const res of [inline, forced]) {
      expect(res.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.get("Content-Security-Policy")).toBe(
        "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      );
    }
  });

  it("encodes awkward file names safely in Content-Disposition", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const id = await a.upload(root.id, 'we"ird éè name.png', png);
    const res = await binary(a.get(`/api/files/${id}/content?download=1`));
    const disposition = res.get("Content-Disposition") ?? "";
    expect(disposition).toContain("filename*=UTF-8''we%22ird%20%C3%A9%C3%A8%20name.png");
    expect(disposition).not.toMatch(/[\r\n]/);
  });

  it("supports Range requests and ETag revalidation", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const bytes = Buffer.from("0123456789");
    const id = await a.upload(root.id, "digits.txt", bytes);
    const part = await binary(a.get(`/api/files/${id}/content`).set("Range", "bytes=2-5"));
    expect(part.status).toBe(206);
    expect(part.get("Content-Range")).toBe("bytes 2-5/10");
    expect(part.body).toEqual(Buffer.from("2345"));
    expect(part.get("X-Content-Type-Options")).toBe("nosniff");
    const full = await binary(a.get(`/api/files/${id}/content`));
    const etag = full.get("ETag") ?? "";
    expect(etag).not.toBe("");
    const cached = await a.get(`/api/files/${id}/content`).set("If-None-Match", etag);
    expect(cached.status).toBe(304);
    const bad = await a.get(`/api/files/${id}/content`).set("Range", "bytes=50-60");
    expect(bad.status).toBe(416);
  });

  it("answers 404 for folders", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    expect((await a.get(`/api/files/${root.id}/content`)).status).toBe(404);
    expect((await a.get(`/api/files/${root.id}/versions`)).status).toBe(404);
  });
});

describe("ownership: user B never sees user A's items", () => {
  it("answers 404, never 403, on every file endpoint", async () => {
    const h = harness();
    const { a, b } = await twoUsers(h);
    const aRoot = (await a.root()).folder;
    const bRoot = (await b.root()).folder;
    const folder = await a.mkdir(aRoot.id, "private");
    const fileId = await a.upload(folder.id, "mine.txt", Buffer.from("one"));
    await a.upload(folder.id, "mine.txt", Buffer.from("two"), fileId);
    const [current, old] = await versionsOf(a, fileId);
    if (!current || !old) throw new Error("expected two versions");
    const trashed = await a.mkdir(aRoot.id, "bin");
    await a.del(`/api/files/${trashed.id}`);
    const bFile = await b.upload(bRoot.id, "b.txt", Buffer.from("b"));

    const attempts: [string, Awaited<ReturnType<typeof b.get>>][] = [
      ["GET folder", await b.get(`/api/folders/${folder.id}`)],
      ["GET root id as folder", await b.get(`/api/folders/${aRoot.id}`)],
      ["POST folder into it", await b.post("/api/folders", { parentId: folder.id, name: "x" })],
      ["PATCH rename", await b.patch(`/api/files/${fileId}`, { name: "x" })],
      ["PATCH move out", await b.patch(`/api/files/${fileId}`, { parentId: bRoot.id })],
      ["PATCH move in", await b.patch(`/api/files/${bFile}`, { parentId: folder.id })],
      ["DELETE", await b.del(`/api/files/${fileId}`)],
      ["GET content", await b.get(`/api/files/${fileId}/content`)],
      ["GET versions", await b.get(`/api/files/${fileId}/versions`)],
      ["GET version content", await b.get(`/api/files/${fileId}/versions/${old.id}/content`)],
      ["POST version restore", await b.post(`/api/files/${fileId}/versions/${old.id}/restore`)],
      ["DELETE version", await b.del(`/api/files/${fileId}/versions/${old.id}`)],
      ["restore from trash", await b.post(`/api/trash/${trashed.id}/restore`)],
      ["purge from trash", await b.del(`/api/trash/${trashed.id}`)],
    ];
    for (const [label, res] of attempts) {
      expect(res.status, label).toBe(404);
      expect(errorCode(res), label).toBe("not_found");
    }
    // B's own version ids do not open A's file either, and nothing of A leaked into B's views.
    const bVersions = await b.get(`/api/files/${bFile}/versions`);
    const [bVersion] = versionListing.parse(bVersions.body).versions;
    expect(
      (await b.get(`/api/files/${fileId}/versions/${bVersion?.id ?? ""}/content`)).status,
    ).toBe(404);
    expect((await a.get(`/api/files/${bFile}/content`)).status).toBe(404);
    expect((await b.root()).children.map((c) => c.name)).toEqual(["b.txt"]);
    expect((await b.get("/api/trash")).body).toEqual({ items: [], retentionDays: 30 });
    expect(usageResponse.parse((await b.get("/api/usage")).body).usedBytes).toBe(1);

    // A is unaffected by all of that.
    expect((await binary(a.get(`/api/files/${fileId}/content`))).body).toEqual(Buffer.from("two"));
    expect(trashListing.parse((await a.get("/api/trash")).body).items).toHaveLength(1);
  });
});

describe("usage and admin summary", () => {
  it("reports usage over all versions, trashed included, and usedBytes per user for admins", async () => {
    const h = harness();
    const { a, b } = await twoUsers(h);
    const aRoot = (await a.root()).folder;
    const bRoot = (await b.root()).folder;
    const f = await a.upload(aRoot.id, "f.txt", Buffer.from("12345"));
    await a.upload(aRoot.id, "f.txt", Buffer.from("123"), f);
    const g = await a.upload(aRoot.id, "g.txt", Buffer.from("12"));
    await a.del(`/api/files/${g}`);
    await b.upload(bRoot.id, "b.txt", Buffer.from("1234567"));

    const usage = usageResponse.parse((await a.get("/api/usage")).body);
    expect(usage.usedBytes).toBe(10);
    expect(usage.quotaBytes).toBe(a.user.quotaBytes);

    const res = await a.get("/api/admin/users");
    const used = Object.fromEntries(
      (res.body as { users: { email: string; usedBytes: number }[] }).users.map((u) => [
        u.email,
        u.usedBytes,
      ]),
    );
    expect(used).toEqual({ "admin@example.com": 10, "b@example.com": 7 });
  });
});
