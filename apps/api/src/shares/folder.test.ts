import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { errorResponse, publicFolderListing } from "@cloud/shared";
import { binary, blobFile, harness, type Harness } from "../testing/harness.js";
import { createLink, readZip, visitor } from "../testing/shares.js";
import { fileVersions } from "../db/schema/index.js";

function code(res: { body: unknown }): string {
  return errorResponse.parse(res.body).error.code;
}

/**
 * aRoot
 *  ├ Shared            ← shared
 *  │  ├ top.txt, .hidden
 *  │  ├ Sub ─ deep.txt, Deeper ─ deepest.txt
 *  │  ├ Empty
 *  │  ├ OnlyTrash ─ (trashed: ghost.txt)
 *  │  ├ Gone (trashed) ─ lost.txt
 *  │  └ binned.txt (trashed)
 *  ├ Sibling ─ sib.txt
 *  └ outside.txt
 * bRoot ─ Theirs ─ theirs.txt
 */
async function tree(h: Harness) {
  const a = await h.admin();
  const b = await h.member("b@example.com");
  const aRoot = (await a.root()).folder;
  const bRoot = (await b.root()).folder;
  const shared = await a.mkdir(aRoot.id, "Shared");
  const top = await a.upload(shared.id, "top.txt", Buffer.from("top"));
  const hidden = await a.upload(shared.id, ".hidden", Buffer.from("hidden"));
  const sub = await a.mkdir(shared.id, "Sub");
  const deep = await a.upload(sub.id, "deep.txt", Buffer.from("deep"));
  const deeper = await a.mkdir(sub.id, "Deeper");
  const deepest = await a.upload(deeper.id, "deepest.txt", Buffer.from("deepest"));
  const empty = await a.mkdir(shared.id, "Empty");
  const onlyTrash = await a.mkdir(shared.id, "OnlyTrash");
  const ghost = await a.upload(onlyTrash.id, "ghost.txt", Buffer.from("ghost"));
  await a.del(`/api/files/${ghost}`);
  const gone = await a.mkdir(shared.id, "Gone");
  const lost = await a.upload(gone.id, "lost.txt", Buffer.from("lost"));
  await a.del(`/api/files/${gone.id}`);
  const binned = await a.upload(shared.id, "binned.txt", Buffer.from("binned"));
  await a.del(`/api/files/${binned}`);
  const sibling = await a.mkdir(aRoot.id, "Sibling");
  const sib = await a.upload(sibling.id, "sib.txt", Buffer.from("sib"));
  const outside = await a.upload(aRoot.id, "outside.txt", Buffer.from("outside"));
  const theirs = await b.mkdir(bRoot.id, "Theirs");
  const theirsFile = await b.upload(theirs.id, "theirs.txt", Buffer.from("theirs"));
  const link = await createLink(a, { fileId: shared.id });
  return {
    h,
    a,
    b,
    aRoot,
    bRoot,
    link,
    ids: {
      shared,
      top,
      hidden,
      sub,
      deep,
      deeper,
      deepest,
      empty,
      onlyTrash,
      gone,
      lost,
      binned,
      sibling,
      sib,
      outside,
      theirs,
      theirsFile,
    },
  };
}

describe("folder share browsing", () => {
  it("lists the shared folder, folders first, with only public fields", async () => {
    const t = await tree(harness());
    const v = visitor(t.h, t.link);
    const res = await v.get("/folder");
    expect(res.status).toBe(200);
    const listing = publicFolderListing.parse(res.body);
    expect(listing.folder).toMatchObject({ id: t.ids.shared.id, name: "Shared", kind: "folder" });
    expect(listing.breadcrumbs).toEqual([{ id: t.ids.shared.id, name: "Shared" }]);
    expect(listing.children.map((c) => c.name)).toEqual([
      "Empty",
      "OnlyTrash",
      "Sub",
      ".hidden",
      "top.txt",
    ]);
    expect(listing.children.find((c) => c.name === "top.txt")).toMatchObject({
      id: t.ids.top,
      kind: "file",
      size: 3,
      mime: "text/plain",
    });
    for (const node of [listing.folder, ...listing.children]) {
      expect(Object.keys(node).sort()).toEqual(["id", "kind", "mime", "name", "size", "updatedAt"]);
    }
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(t.a.user.id);
    expect(text).not.toContain(t.aRoot.id);
    expect(text).not.toContain("parentId");
    // The explicit default is the same answer.
    const explicit = await v.get(`/folder?folderId=${t.ids.shared.id}`);
    expect(explicit.body).toEqual(res.body);
  });

  it("lists nested folders with breadcrumbs that start at the shared folder", async () => {
    const t = await tree(harness());
    const v = visitor(t.h, t.link);
    const res = await v.get(`/folder?folderId=${t.ids.deeper.id}`);
    expect(res.status).toBe(200);
    const listing = publicFolderListing.parse(res.body);
    expect(listing.folder.name).toBe("Deeper");
    expect(listing.breadcrumbs).toEqual([
      { id: t.ids.shared.id, name: "Shared" },
      { id: t.ids.sub.id, name: "Sub" },
      { id: t.ids.deeper.id, name: "Deeper" },
    ]);
    expect(listing.children.map((c) => c.name)).toEqual(["deepest.txt"]);
    // The owner's root is never named in a breadcrumb.
    expect(JSON.stringify(res.body)).not.toContain(t.aRoot.id);
  });

  it("serves files inside the shared subtree and nothing else", async () => {
    const t = await tree(harness());
    const v = visitor(t.h, t.link);
    for (const [id, text] of [
      [t.ids.top, "top"],
      [t.ids.deep, "deep"],
      [t.ids.deepest, "deepest"],
    ] as const) {
      const res = await v.get(`/files/${id}/content`);
      expect(res.status, id).toBe(200);
      expect(res.text).toBe(text);
      expect(res.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("folderId outside the subtree is 404: sibling, parent, root, foreign, missing, file, trashed", async () => {
    const t = await tree(harness());
    const v = visitor(t.h, t.link);
    const outside = [
      t.ids.sibling.id,
      t.aRoot.id,
      t.ids.theirs.id,
      t.bRoot.id,
      "00000000-0000-4000-8000-000000000000",
      "../../etc",
      t.ids.top, // a file, not a folder
      t.ids.gone.id, // trashed folder inside the share
      t.ids.outside,
    ];
    for (const id of outside) {
      for (const path of [
        `/folder?folderId=${encodeURIComponent(id)}`,
        `/zip?folderId=${encodeURIComponent(id)}`,
      ]) {
        const res = await v.get(path);
        expect([res.status, code(res)], path).toEqual([404, "not_found"]);
      }
    }
    expect((await v.get("/folder?folderId=")).status).toBe(400);
    expect(
      (await v.get(`/folder?folderId=${t.ids.sub.id}&folderId=${t.ids.deeper.id}`)).status,
    ).toBe(400);
  });

  it("fileId outside the subtree is 404: sibling, parent, foreign, trashed, in a trashed folder, a folder", async () => {
    const t = await tree(harness());
    const v = visitor(t.h, t.link);
    const outside = [
      t.ids.sib,
      t.ids.outside,
      t.ids.theirsFile,
      t.ids.binned, // trashed file inside the share
      t.ids.lost, // active file inside a trashed folder
      t.ids.sub.id, // a folder
      t.ids.shared.id,
      t.aRoot.id,
      "00000000-0000-4000-8000-000000000000",
      "..",
    ];
    for (const id of outside) {
      const res = await v.get(`/files/${encodeURIComponent(id)}/content`);
      expect([res.status, code(res)], id).toEqual([404, "not_found"]);
    }
    // Content of the share itself is a file-share endpoint.
    expect((await v.get("/content")).status).toBe(404);
  });

  it("follows moves: an item moved out is gone, an item moved in appears", async () => {
    const t = await tree(harness());
    const v = visitor(t.h, t.link);
    expect((await v.get(`/files/${t.ids.sib}/content`)).status).toBe(404);
    expect((await t.a.patch(`/api/files/${t.ids.sib}`, { parentId: t.ids.sub.id })).status).toBe(
      200,
    );
    expect((await v.get(`/files/${t.ids.sib}/content`)).text).toBe("sib");

    expect(
      (await t.a.patch(`/api/files/${t.ids.sub.id}`, { parentId: t.ids.sibling.id })).status,
    ).toBe(200);
    for (const path of [
      `/folder?folderId=${t.ids.sub.id}`,
      `/files/${t.ids.deep}/content`,
      `/files/${t.ids.sib}/content`,
      `/zip?folderId=${t.ids.sub.id}`,
    ]) {
      expect((await v.get(path)).status, path).toBe(404);
    }
    const listing = publicFolderListing.parse((await v.get("/folder")).body);
    expect(listing.children.map((c) => c.name)).not.toContain("Sub");
  });

  it("a share of a subfolder cannot reach its parent or siblings", async () => {
    const t = await tree(harness());
    const link = await createLink(t.a, { fileId: t.ids.sub.id });
    const v = visitor(t.h, link);
    expect(publicFolderListing.parse((await v.get("/folder")).body).breadcrumbs).toEqual([
      { id: t.ids.sub.id, name: "Sub" },
    ]);
    for (const id of [t.ids.shared.id, t.ids.empty.id, t.aRoot.id]) {
      expect((await v.get(`/folder?folderId=${id}`)).status, id).toBe(404);
    }
    for (const id of [t.ids.top, t.ids.hidden]) {
      expect((await v.get(`/files/${id}/content`)).status, id).toBe(404);
    }
    expect((await v.get(`/files/${t.ids.deepest}/content`)).text).toBe("deepest");
  });

  it("applies the same confinement to a password-protected share only after the unlock", async () => {
    const t = await tree(harness());
    const link = await createLink(t.a, {
      fileId: t.ids.shared.id,
      password: "correct horse battery",
    });
    const v = visitor(t.h, link);
    // Locked: every id, in or out of the subtree, gets the same 401 (nothing about the tree leaks).
    for (const path of [
      "/folder",
      `/folder?folderId=${t.ids.sibling.id}`,
      `/files/${t.ids.top}/content`,
      `/files/${t.ids.sib}/content`,
      "/zip",
    ]) {
      const res = await v.get(path);
      expect([res.status, code(res)], path).toEqual([401, "share_locked"]);
    }
  });
});

describe("folder share zip", () => {
  function unzipAvailable(): boolean {
    return spawnSync("unzip", ["-v"]).status === 0;
  }

  async function download(h: Harness, link: Parameters<typeof visitor>[1], path = "/zip") {
    const res = await binary(visitor(h, link).get(path));
    return { res, body: res.body as Buffer };
  }

  it("contains exactly the active subtree, store-only, and excludes trashed items", async () => {
    const t = await tree(harness());
    const { res, body } = await download(t.h, t.link);
    expect(res.status).toBe(200);
    expect(res.get("Content-Type")).toBe("application/zip");
    expect(res.get("Content-Disposition")).toBe("attachment; filename=Shared.zip");
    expect(res.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Number(res.get("Content-Length"))).toBe(body.length);

    const entries = readZip(body);
    expect(entries.map((e) => e.name)).toEqual([
      ".hidden",
      "Empty/",
      "OnlyTrash/",
      "Sub/Deeper/deepest.txt",
      "Sub/deep.txt",
      "top.txt",
    ]);
    expect(entries.every((e) => e.method === 0)).toBe(true);
    const text = (name: string) => entries.find((e) => e.name === name)?.data.toString();
    expect(text("top.txt")).toBe("top");
    expect(text("Sub/Deeper/deepest.txt")).toBe("deepest");
    expect(text("Empty/")).toBe("");
    for (const e of entries) {
      expect(e.size).toBe(e.data.length);
      expect(e.name.startsWith("/")).toBe(false);
      expect(e.name.split("/")).not.toContain("..");
    }
    const joined = entries.map((e) => e.name).join("\n");
    for (const hidden of ["ghost", "lost", "binned", "Gone", "sib", "outside", "theirs"]) {
      expect(joined).not.toContain(hidden);
    }

    if (unzipAvailable()) {
      const file = join(t.h.dataDir, "check.zip");
      writeFileSync(file, body);
      const listed = spawnSync("unzip", ["-Z1", file], { encoding: "utf8" });
      expect(listed.stdout.trim().split("\n")).toEqual(entries.map((e) => e.name));
      expect(spawnSync("unzip", ["-t", file], { encoding: "utf8" }).status).toBe(0);
      unlinkSync(file);
    }
  });

  it("streams large files byte for byte", async () => {
    const t = await tree(harness());
    const big = randomBytes(3_000_000);
    await t.a.upload(t.ids.sub.id, "big.bin", big);
    const { body } = await download(t.h, t.link);
    const entry = readZip(body).find((e) => e.name === "Sub/big.bin");
    expect(entry?.size).toBe(big.length);
    expect(entry?.data.equals(big)).toBe(true);
  });

  it("zips a nested folder relative to itself and rejects folders outside the share", async () => {
    const t = await tree(harness());
    const { res, body } = await download(t.h, t.link, `/zip?folderId=${t.ids.sub.id}`);
    expect(res.get("Content-Disposition")).toBe("attachment; filename=Sub.zip");
    expect(readZip(body).map((e) => e.name)).toEqual(["Deeper/deepest.txt", "deep.txt"]);
    expect((await visitor(t.h, t.link).get(`/zip?folderId=${t.ids.sibling.id}`)).status).toBe(404);
  });

  it("zips an empty folder into a valid empty archive and names unicode folders", async () => {
    const t = await tree(harness());
    const empty = await createLink(t.a, { fileId: t.ids.empty.id });
    const { body } = await download(t.h, empty);
    expect(readZip(body)).toEqual([]);

    const unicode = await t.a.mkdir(t.aRoot.id, 'Fotos ñ "quoted"');
    const link = await createLink(t.a, { fileId: unicode.id });
    const res = await binary(visitor(t.h, link).get("/zip"));
    expect(res.get("Content-Disposition")).toContain(
      "filename*=UTF-8''Fotos%20%C3%B1%20%22quoted%22.zip",
    );
  });

  it("answers HEAD without streaming and a file share with 404", async () => {
    const t = await tree(harness());
    const head = await visitor(t.h, t.link).head("/zip");
    expect(head.status).toBe(200);
    expect(head.get("Content-Type")).toBe("application/zip");
    const fileLink = await createLink(t.a, { fileId: t.ids.top });
    expect((await visitor(t.h, fileLink).get("/zip")).status).toBe(404);
  });

  it("answers 500 before sending anything when a blob is missing from disk", async () => {
    const t = await tree(harness());
    const version = t.h.db
      .select()
      .from(fileVersions)
      .all()
      .find((v) => v.fileId === t.ids.top);
    expect(version).toBeDefined();
    unlinkSync(blobFile(t.h.dataDir, t.a.user.id, version?.id ?? ""));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await visitor(t.h, t.link).get("/zip");
      expect([res.status, code(res)]).toEqual([500, "internal"]);
      expect(res.get("Content-Type")).toContain("application/json");
    } finally {
      error.mockRestore();
    }
  });
});
