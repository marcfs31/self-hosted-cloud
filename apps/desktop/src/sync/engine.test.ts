import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, NetworkError } from "../api/client.js";
import {
  edit,
  newAccount,
  newDevice,
  put,
  snapshotDir,
  SpyApi,
  text,
  waitFor,
  type Account,
  type Device,
} from "../testing/harness.js";
import { startApi, type LiveApi } from "../testing/live-api.js";
import { SyncError, type SyncStatus } from "./engine.js";

let api: LiveApi;

beforeAll(async () => {
  api = await startApi();
});

afterAll(async () => {
  await api.close();
});

async function twoWaySynced(files: Record<string, string>): Promise<{ acc: Account; dev: Device }> {
  const acc = await newAccount(api);
  for (const [path, content] of Object.entries(files)) await acc.web.write(path, content);
  const dev = newDevice(api, acc);
  await dev.sync();
  return { acc, dev };
}

const CONFLICT_COPY = /^(.*) \(conflicted copy Laptop \d{4}-\d{2}-\d{2} \d{2}-\d{2}\)(\..*)?$/;

describe("first sync", () => {
  it("downloads everything, byte-exact, and a second run does nothing", async () => {
    const acc = await newAccount(api);
    const big = randomBytes(300 * 1024);
    await acc.web.write("docs/a.txt", "alpha");
    await acc.web.write("docs/deep/blob.bin", big);
    await acc.web.write("top.txt", "t");
    await acc.web.mkdir("empty");
    const dev = newDevice(api, acc);

    const first = await dev.sync();
    expect(first).toMatchObject({ downloaded: 3, uploaded: 0, conflicts: 0, errors: 0 });
    expect(Object.keys(snapshotDir(dev.dir))).toEqual([
      "docs/",
      "docs/a.txt",
      "docs/deep/",
      "docs/deep/blob.bin",
      "empty/",
      "top.txt",
    ]);
    expect(readFileSync(join(dev.dir, "docs/deep/blob.bin")).equals(big)).toBe(true);
    expect(text(dev.dir, "docs/a.txt")).toBe("alpha");

    const state = JSON.parse(readFileSync(dev.stateFile, "utf8")) as {
      cursor: string;
      rootId: string;
      entries: Record<string, { fileId: string; sha256: string | null }>;
    };
    expect(state.cursor).toEqual(expect.any(String));
    expect(Object.keys(state.entries)).toHaveLength(6);
    expect(await dev.sync()).toEqual({
      uploaded: 0,
      downloaded: 0,
      renamed: 0,
      trashedRemote: 0,
      trashedLocal: 0,
      conflicts: 0,
      rejected: 0,
      errors: 0,
    });
  });

  it("adopts identical files and keeps both when a pre-existing local file differs", async () => {
    const acc = await newAccount(api);
    await acc.web.write("same.txt", "identical");
    await acc.web.write("differs.txt", "remote side");
    const dev = newDevice(api, acc);
    put(dev.dir, "same.txt", "identical");
    put(dev.dir, "differs.txt", "local side");

    const result = await dev.sync();
    expect(result.conflicts).toBe(1);
    expect(await acc.web.versionCount("same.txt")).toBe(1);
    expect(text(dev.dir, "differs.txt")).toBe("remote side");
    const copy = readdirSync(dev.dir).find((n) => n.startsWith("differs ("));
    expect(copy).toMatch(CONFLICT_COPY);
    expect(text(dev.dir, copy ?? "")).toBe("local side");
    expect(await acc.web.content(copy ?? "")).toBe("local side");
  });
});

describe("local changes propagate", () => {
  it("creates, modifies (even same-size, right away) and deletes", async () => {
    const acc = await newAccount(api);
    const dev = newDevice(api, acc);
    put(dev.dir, "notes/one.txt", "1");
    put(dev.dir, "two.txt", "22");
    put(dev.dir, "empty.txt", "");

    expect(await dev.sync()).toMatchObject({ uploaded: 3, errors: 0 });
    const remote = await acc.web.tree();
    expect([...remote.keys()].sort()).toEqual(["empty.txt", "notes", "notes/one.txt", "two.txt"]);
    expect(await acc.web.content("notes/one.txt")).toBe("1");
    const twoTxt = dev.activity.filter((a) => a.type === "upload" && a.path === "two.txt");
    expect(twoTxt.map((a) => a.phase)).toEqual(["start", "done"]);
    expect(await acc.web.content("empty.txt")).toBe("");

    edit(dev.dir, "two.txt", "222");
    await dev.sync();
    expect(await acc.web.content("two.txt")).toBe("222");
    expect(await acc.web.versionCount("two.txt")).toBe(2);

    // Same size, written straight after the last sync: only a content hash can tell.
    edit(dev.dir, "two.txt", "333");
    await dev.sync();
    expect(await acc.web.content("two.txt")).toBe("333");
    expect(await acc.web.versionCount("two.txt")).toBe(3);

    rmSync(join(dev.dir, "notes/one.txt"));
    const afterFile = await dev.sync();
    expect(afterFile.trashedRemote).toBe(1);
    expect((await acc.web.tree()).has("notes/one.txt")).toBe(false);
    expect(await acc.web.trashNames()).toContain("one.txt");

    rmSync(join(dev.dir, "notes"), { recursive: true });
    await dev.sync();
    expect((await acc.web.tree()).has("notes")).toBe(false);
  });

  it("turns a local rename or move into a remote rename of the same file", async () => {
    const { acc, dev } = await twoWaySynced({
      "x.txt": "move me",
      "d/inner.txt": "in a folder",
      "d/deeper/leaf.txt": "leaf",
    });
    const ids = await acc.web.tree();

    mkdirSync(join(dev.dir, "sub"));
    renameSync(join(dev.dir, "x.txt"), join(dev.dir, "sub/y.txt"));
    const first = await dev.sync();
    expect(first).toMatchObject({ renamed: 1, uploaded: 0, trashedRemote: 0 });
    expect((await acc.web.item("sub/y.txt")).id).toBe(ids.get("x.txt")?.id);
    expect((await acc.web.tree()).has("x.txt")).toBe(false);
    expect(await acc.web.versionCount("sub/y.txt")).toBe(1);
    expect(await acc.web.trashNames()).toEqual([]);

    renameSync(join(dev.dir, "sub/y.txt"), join(dev.dir, "sub/z.txt"));
    await dev.sync();
    expect((await acc.web.item("sub/z.txt")).id).toBe(ids.get("x.txt")?.id);

    // A whole folder: its files keep their identity, the old folder is trashed.
    renameSync(join(dev.dir, "d"), join(dev.dir, "e"));
    const folder = await dev.sync();
    expect(folder).toMatchObject({ uploaded: 0, downloaded: 0 });
    expect((await acc.web.item("e/inner.txt")).id).toBe(ids.get("d/inner.txt")?.id);
    expect((await acc.web.item("e/deeper/leaf.txt")).id).toBe(ids.get("d/deeper/leaf.txt")?.id);
    const names = [...(await acc.web.tree()).keys()];
    expect(names.filter((n) => n === "d" || n.startsWith("d/"))).toEqual([]);
    expect(snapshotDir(dev.dir)["e/inner.txt"]).toBe("in a folder");
  });
});

describe("remote changes propagate", () => {
  it("creates, modifies, renames, moves, renames folders and trashes", async () => {
    const { acc, dev } = await twoWaySynced({
      "docs/a.txt": "a1",
      "docs/b.txt": "b1",
      "docs/c.txt": "c1",
      "dir/keep.txt": "keep",
    });
    const inoB = statSync(join(dev.dir, "docs/b.txt")).ino;

    await acc.web.write("docs/new.txt", "fresh");
    await acc.web.write("docs/a.txt", "a2 longer");
    await acc.web.rename("docs/b.txt", "b2.txt");
    await acc.web.move("docs/c.txt", "dir");
    const first = await dev.sync();
    expect(first).toMatchObject({ downloaded: 2, uploaded: 0, trashedLocal: 0, errors: 0 });
    expect(snapshotDir(dev.dir)).toEqual({
      "dir/": "",
      "dir/c.txt": "c1",
      "dir/keep.txt": "keep",
      "docs/": "",
      "docs/a.txt": "a2 longer",
      "docs/b2.txt": "b1",
      "docs/new.txt": "fresh",
    });
    expect(statSync(join(dev.dir, "docs/b2.txt")).ino).toBe(inoB);

    await acc.web.rename("dir", "dir2");
    await acc.web.trash("docs/new.txt");
    await dev.sync();
    expect(snapshotDir(dev.dir)).toEqual({
      "dir2/": "",
      "dir2/c.txt": "c1",
      "dir2/keep.txt": "keep",
      "docs/": "",
      "docs/a.txt": "a2 longer",
      "docs/b2.txt": "b1",
    });
    // Removed files go to the trash folder, never into thin air.
    const trashed = readdirSync(join(dev.dataDir, ".cloud-trash"));
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatch(/new\.txt$/);
  });

  it("moves a deleted remote folder into the local trash, but keeps a local edit inside it", async () => {
    const { acc, dev } = await twoWaySynced({
      "gone/a.txt": "a",
      "gone/b.txt": "b",
      "stay/x.txt": "x",
      "mixed/keep.txt": "k",
      "mixed/edited.txt": "before",
    });
    await acc.web.trash("gone");
    await acc.web.trash("mixed");
    edit(dev.dir, "mixed/edited.txt", "after");
    const result = await dev.sync();
    expect(result.errors).toBe(0);
    expect(existsSync(join(dev.dir, "gone"))).toBe(false);
    expect(readdirSync(join(dev.dataDir, ".cloud-trash")).length).toBeGreaterThanOrEqual(2);
    expect(snapshotDir(dev.dir)).toMatchObject({ "mixed/edited.txt": "after", "stay/x.txt": "x" });
    expect(existsSync(join(dev.dir, "mixed/keep.txt"))).toBe(false);
    expect(await acc.web.content("mixed/edited.txt")).toBe("after");
  });
});

describe("conflicts", () => {
  it("keeps both edits: a conflicted copy locally and remotely, the server's version under the name", async () => {
    const { acc, dev } = await twoWaySynced({ "f.txt": "base" });
    edit(dev.dir, "f.txt", "local edit");
    await acc.web.write("f.txt", "remote edit");

    const result = await dev.sync();
    expect(result).toMatchObject({ conflicts: 1, errors: 0 });
    const snap = snapshotDir(dev.dir);
    expect(snap["f.txt"]).toBe("remote edit");
    const copies = Object.keys(snap).filter((n) => n !== "f.txt");
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(CONFLICT_COPY);
    expect(snap[copies[0] ?? ""]).toBe("local edit");
    expect(await acc.web.content("f.txt")).toBe("remote edit");
    expect(await acc.web.content(copies[0] ?? "")).toBe("local edit");
    expect(dev.activity.some((a) => a.type === "conflict" && a.path === "f.txt")).toBe(true);

    const again = await dev.sync();
    expect(again).toMatchObject({ conflicts: 0, uploaded: 0, downloaded: 0 });
  });

  it("an edit beats a delete, whichever side deleted", async () => {
    const { acc, dev } = await twoWaySynced({ "local-del.txt": "v1", "remote-del.txt": "v1" });

    rmSync(join(dev.dir, "local-del.txt"));
    await acc.web.write("local-del.txt", "edited on web");
    edit(dev.dir, "remote-del.txt", "edited locally");
    await acc.web.trash("remote-del.txt");

    const result = await dev.sync();
    expect(result.errors).toBe(0);
    expect(text(dev.dir, "local-del.txt")).toBe("edited on web");
    expect(text(dev.dir, "remote-del.txt")).toBe("edited locally");
    expect(await acc.web.content("remote-del.txt")).toBe("edited locally");
    expect(await acc.web.content("local-del.txt")).toBe("edited on web");
  });
});

describe("two devices", () => {
  it.each([["A first"], ["B first"]])(
    "converge after a web edit, an edit on A and a delete on B (%s)",
    async (order) => {
      const acc = await newAccount(api);
      await acc.web.write("shared/f.txt", "v1");
      await acc.web.write("keep.txt", "keep");
      const a = newDevice(api, acc, "Laptop");
      const b = newDevice(api, acc, "Desktop");
      await a.sync();
      await b.sync();
      expect(snapshotDir(a.dir)).toEqual(snapshotDir(b.dir));

      await acc.web.write("shared/f.txt", "web edit");
      edit(a.dir, "shared/f.txt", "edit on A");
      rmSync(join(b.dir, "shared/f.txt"));

      const sequence = order === "A first" ? [a, b, a, b] : [b, a, b, a];
      for (const device of sequence) await device.sync();

      const snapA = snapshotDir(a.dir);
      expect(snapA).toEqual(snapshotDir(b.dir));
      expect(snapA["shared/f.txt"]).toBe("web edit");
      expect(snapA["keep.txt"]).toBe("keep");
      const copy = Object.keys(snapA).find((n) => n.startsWith("shared/f ("));
      expect(copy).toMatch(/conflicted copy Laptop/);
      expect(snapA[copy ?? ""]).toBe("edit on A");
      const remote = await acc.web.tree();
      expect([...remote.keys()].sort()).toEqual(
        ["keep.txt", "shared", "shared/f.txt", copy ?? ""].sort(),
      );
      expect(await acc.web.trashNames()).toEqual([]);
      for (const device of [a, b]) {
        expect(await device.sync()).toMatchObject({
          uploaded: 0,
          downloaded: 0,
          trashedRemote: 0,
          trashedLocal: 0,
          conflicts: 0,
        });
      }
    },
  );

  it("a delete on one device reaches the other, a rename too", async () => {
    const acc = await newAccount(api);
    await acc.web.write("one.txt", "1");
    await acc.web.write("two.txt", "2");
    const a = newDevice(api, acc, "Laptop");
    const b = newDevice(api, acc, "Desktop");
    await a.sync();
    await b.sync();
    rmSync(join(a.dir, "one.txt"));
    renameSync(join(a.dir, "two.txt"), join(a.dir, "three.txt"));
    await a.sync();
    await b.sync();
    expect(snapshotDir(b.dir)).toEqual({ "three.txt": "2" });
  });
});

describe("crash safety", () => {
  it("a crash between download and state save makes no deletions and no duplicates", async () => {
    const acc = await newAccount(api);
    const dev = newDevice(api, acc);
    await dev.sync();
    const before = readFileSync(dev.stateFile, "utf8");
    await acc.web.write("x.txt", "x");
    await acc.web.write("sub/y.txt", "y");
    await dev.sync();
    writeFileSync(dev.stateFile, before); // the process died before the new state hit the disk

    const restarted = dev.restart();
    const result = await restarted.sync();
    expect(result).toMatchObject({
      trashedLocal: 0,
      trashedRemote: 0,
      conflicts: 0,
      uploaded: 0,
      errors: 0,
    });
    expect(snapshotDir(dev.dir)).toEqual({ "sub/": "", "sub/y.txt": "y", "x.txt": "x" });
    expect(await acc.web.versionCount("x.txt")).toBe(1);
    expect(await acc.web.trashNames()).toEqual([]);
  });

  it("a crash after a local trash step does not delete or resurrect anything", async () => {
    const { acc, dev } = await twoWaySynced({ "z.txt": "z", "stay.txt": "stay" });
    const before = readFileSync(dev.stateFile, "utf8");
    await acc.web.trash("z.txt");
    await dev.sync();
    expect(existsSync(join(dev.dir, "z.txt"))).toBe(false);
    writeFileSync(dev.stateFile, before);

    const result = await dev.restart().sync();
    expect(result).toMatchObject({ trashedRemote: 0, uploaded: 0, downloaded: 0, errors: 0 });
    expect(snapshotDir(dev.dir)).toEqual({ "stay.txt": "stay" });
    expect([...(await acc.web.tree()).keys()]).toEqual(["stay.txt"]);
  });

  it("a crash after uploading an edit adopts it instead of calling it a conflict", async () => {
    const { acc, dev } = await twoWaySynced({ "e.txt": "before" });
    const before = readFileSync(dev.stateFile, "utf8");
    edit(dev.dir, "e.txt", "edited!");
    await dev.sync();
    writeFileSync(dev.stateFile, before);

    const result = await dev.restart().sync();
    expect(result).toMatchObject({ conflicts: 0, uploaded: 0, downloaded: 0, errors: 0 });
    expect(snapshotDir(dev.dir)).toEqual({ "e.txt": "edited!" });
    expect(await acc.web.versionCount("e.txt")).toBe(2);
  });

  it("a crash after trashing a locally deleted file remotely does not bring it back", async () => {
    const { acc, dev } = await twoWaySynced({ "d.txt": "d", "k.txt": "k" });
    const before = readFileSync(dev.stateFile, "utf8");
    rmSync(join(dev.dir, "d.txt"));
    await dev.sync();
    writeFileSync(dev.stateFile, before);

    const result = await dev.restart().sync();
    expect(result).toMatchObject({ trashedRemote: 0, downloaded: 0, uploaded: 0, errors: 0 });
    expect(snapshotDir(dev.dir)).toEqual({ "k.txt": "k" });
    expect([...(await acc.web.tree()).keys()]).toEqual(["k.txt"]);
  });

  it("a crash after an upload does not upload it twice", async () => {
    const acc = await newAccount(api);
    const dev = newDevice(api, acc);
    await dev.sync();
    const before = readFileSync(dev.stateFile, "utf8");
    put(dev.dir, "u.txt", "uploaded once");
    await dev.sync();
    writeFileSync(dev.stateFile, before);

    const result = await dev.restart().sync();
    expect(result).toMatchObject({ uploaded: 0, conflicts: 0, errors: 0 });
    expect([...(await acc.web.tree()).keys()]).toEqual(["u.txt"]);
    expect(await acc.web.versionCount("u.txt")).toBe(1);
  });

  it("a lost or corrupt state file is a first sync: nothing deleted, nothing duplicated", async () => {
    const { acc, dev } = await twoWaySynced({ "a.txt": "a", "dir/b.txt": "b" });
    put(dev.dir, "local-only.txt", "l");
    await dev.sync();
    const snapshot = snapshotDir(dev.dir);

    rmSync(dev.stateFile);
    const lost = await dev.restart().sync();
    expect(lost).toMatchObject({ trashedLocal: 0, trashedRemote: 0, conflicts: 0, uploaded: 0 });
    expect(snapshotDir(dev.dir)).toEqual(snapshot);

    writeFileSync(dev.stateFile, '{"version":1,"entries":{"a.t');
    writeFileSync(`${dev.stateFile}.123.tmp`, "half written");
    const corrupt = await dev.restart().sync();
    expect(corrupt).toMatchObject({ trashedLocal: 0, trashedRemote: 0, conflicts: 0, uploaded: 0 });
    expect(snapshotDir(dev.dir)).toEqual(snapshot);
    expect(readdirSync(dev.dataDir).some((n) => n.includes(".corrupt-"))).toBe(true);
    expect(await acc.web.trashNames()).toEqual([]);
    expect(await acc.web.versionCount("a.txt")).toBe(1);
  });

  it("a connection that drops mid-sync leaves a state the next run completes without deleting", async () => {
    const acc = await newAccount(api);
    for (let i = 0; i < 6; i++)
      await acc.web.write(`dir/f${String(i)}.txt`, `content ${String(i)}`);
    let downloads = 0;
    const flaky = new SpyApi(acc.client(), (call) => {
      if (call === "download" && ++downloads === 4) throw new NetworkError("connection lost");
    });
    const dev = newDevice(api, acc, "Laptop", undefined, { api: flaky });
    await expect(dev.sync()).rejects.toBeInstanceOf(NetworkError);
    expect(dev.engine.status.state).toBe("offline");

    const result = await dev.restart().sync();
    expect(result).toMatchObject({ trashedLocal: 0, trashedRemote: 0, conflicts: 0, errors: 0 });
    expect(Object.keys(snapshotDir(dev.dir))).toHaveLength(7);
    expect(await acc.web.trashNames()).toEqual([]);
  });

  it("never treats a missing sync folder as 'everything was deleted'", async () => {
    const { acc, dev } = await twoWaySynced({ "a.txt": "a", "dir/b.txt": "b" });
    rmSync(dev.dir, { recursive: true });
    await expect(dev.sync()).rejects.toMatchObject({ code: "local_root_missing" });
    expect(dev.engine.status).toEqual({ state: "error", code: "local_root_missing" });
    expect([...(await acc.web.tree()).keys()].sort()).toEqual(["a.txt", "dir", "dir/b.txt"]);
    expect(await acc.web.trashNames()).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    "does not read an unreadable folder as 'its files were deleted'",
    async () => {
      const { acc, dev } = await twoWaySynced({ "locked/a.txt": "a", "open/b.txt": "b" });
      chmodSync(join(dev.dir, "locked"), 0o000);
      try {
        edit(dev.dir, "open/b.txt", "b2");
        const result = await dev.sync();
        expect(result).toMatchObject({ trashedRemote: 0, trashedLocal: 0, uploaded: 1 });
        expect([...(await acc.web.tree()).keys()].sort()).toEqual([
          "locked",
          "locked/a.txt",
          "open",
          "open/b.txt",
        ]);
        expect(await acc.web.trashNames()).toEqual([]);
      } finally {
        chmodSync(join(dev.dir, "locked"), 0o755);
      }
    },
  );

  it("refuses to run another account's state against this account", async () => {
    const { dev } = await twoWaySynced({ "a.txt": "a" });
    const other = await newAccount(api);
    await other.web.write("theirs.txt", "theirs");
    const swapped = newDevice(api, other, "Laptop", { dir: dev.dir, dataDir: dev.dataDir });
    await expect(swapped.sync()).rejects.toBeInstanceOf(SyncError);
    expect(swapped.engine.status).toEqual({ state: "error", code: "account_changed" });
    expect(text(dev.dir, "a.txt")).toBe("a");
    expect([...(await other.web.tree()).keys()]).toEqual(["theirs.txt"]);
  });
});

describe("awkward combinations", () => {
  it("a remote rename of a file the user edited locally uploads the edit at the new name", async () => {
    const { acc, dev } = await twoWaySynced({ "old.txt": "v1" });
    await acc.web.rename("old.txt", "new.txt");
    edit(dev.dir, "old.txt", "local v2");
    const result = await dev.sync();
    expect(result).toMatchObject({ errors: 0, conflicts: 0 });
    expect(snapshotDir(dev.dir)).toEqual({ "new.txt": "local v2" });
    expect(await acc.web.content("new.txt")).toBe("local v2");
    expect(await acc.web.versionCount("new.txt")).toBe(2);
  });

  it("a local delete of a file the web renamed brings the file back under its new name", async () => {
    const { acc, dev } = await twoWaySynced({ "old.txt": "v1", "other.txt": "o" });
    await acc.web.rename("old.txt", "new.txt");
    rmSync(join(dev.dir, "old.txt"));
    await dev.sync();
    expect(snapshotDir(dev.dir)).toEqual({ "new.txt": "v1", "other.txt": "o" });
    expect([...(await acc.web.tree()).keys()].sort()).toEqual(["new.txt", "other.txt"]);
  });

  it("a file replaced by a folder of the same name (and back) syncs", async () => {
    const { acc, dev } = await twoWaySynced({ thing: "i am a file" });
    rmSync(join(dev.dir, "thing"));
    put(dev.dir, "thing/inside.txt", "now a folder");
    await dev.sync();
    expect(await acc.web.content("thing/inside.txt")).toBe("now a folder");
    expect(snapshotDir(dev.dir)).toEqual({ "thing/": "", "thing/inside.txt": "now a folder" });
    expect((await acc.web.item("thing")).kind).toBe("folder");
  });

  it("a folder created remotely while the same name is a local file keeps both", async () => {
    const acc = await newAccount(api);
    const dev = newDevice(api, acc);
    await dev.sync();
    put(dev.dir, "clash", "local file");
    await acc.web.write("clash/remote.txt", "remote");
    const result = await dev.sync();
    expect(result).toMatchObject({ conflicts: 1, errors: 0 });
    expect(text(dev.dir, "clash/remote.txt")).toBe("remote");
    const copy = readdirSync(dev.dir).find((n) => n.startsWith("clash ("));
    expect(text(dev.dir, copy ?? "")).toBe("local file");
    expect(await acc.web.content(copy ?? "")).toBe("local file");
  });

  it("a local folder deleted while it gained a remote file keeps the remote file", async () => {
    const { acc, dev } = await twoWaySynced({ "dir/a.txt": "a" });
    rmSync(join(dev.dir, "dir"), { recursive: true });
    await acc.web.write("dir/b.txt", "b from web");
    await dev.sync();
    expect(snapshotDir(dev.dir)).toEqual({ "dir/": "", "dir/b.txt": "b from web" });
    expect([...(await acc.web.tree()).keys()].sort()).toEqual(["dir", "dir/b.txt"]);
  });

  it("new local files inside a folder the web just trashed bring the folder back", async () => {
    const { acc, dev } = await twoWaySynced({ "dir/a.txt": "a" });
    await acc.web.trash("dir");
    put(dev.dir, "dir/fresh.txt", "fresh");
    await dev.sync();
    expect(await acc.web.content("dir/fresh.txt")).toBe("fresh");
    expect(existsSync(join(dev.dir, "dir/a.txt"))).toBe(false);
  });

  it("does not create a second file whose name differs only by case", async () => {
    const acc = await newAccount(api);
    await acc.web.write("Case.txt", "upper");
    await acc.web.write("case.txt", "lower");
    const dev = newDevice(api, acc);
    const result = await dev.sync();
    expect(result.rejected + result.downloaded).toBe(2);
    expect(result.errors).toBe(0);
    const names = readdirSync(dev.dir).filter((n) => n.toLowerCase() === "case.txt");
    expect(names).toHaveLength(1);
  });

  it("downloads a file whose local path is occupied by a folder it replaced in the feed", async () => {
    const { acc, dev } = await twoWaySynced({ "swap/inner.txt": "inner" });
    await acc.web.trash("swap");
    await acc.web.write("swap", "now a file");
    await dev.sync();
    expect(snapshotDir(dev.dir)).toEqual({ swap: "now a file" });
  });
});

describe("what is and is not synced", () => {
  it("never uploads OS litter, lock files or temp files, and never downloads or deletes them", async () => {
    const acc = await newAccount(api);
    const dev = newDevice(api, acc);
    for (const name of [
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      "._resource",
      "~$lock.docx",
      "scratch.tmp",
      ".cloud-tmp-abc",
      "sub/.DS_Store",
      "tmpdir.tmp/inside.txt",
    ]) {
      put(dev.dir, name, "junk");
    }
    put(dev.dir, "real.txt", "real");
    await acc.web.write("remote.tmp", "remote temp");

    await dev.sync();
    await dev.sync();
    expect([...(await acc.web.tree()).keys()].sort()).toEqual(
      ["remote.tmp", "real.txt", "sub"].sort(),
    );
    expect(existsSync(join(dev.dir, "remote.tmp"))).toBe(false);
    expect(existsSync(join(dev.dir, ".DS_Store"))).toBe(true);
    expect(await acc.web.trashNames()).toEqual([]);
  });

  it("reports names the server would refuse and carries on", async () => {
    const acc = await newAccount(api);
    const dev = newDevice(api, acc);
    put(dev.dir, "ok.txt", "ok");
    put(dev.dir, "trailing ", "bad");
    put(dev.dir, "badfolder /inside.txt", "bad");

    const result = await dev.sync();
    expect(result).toMatchObject({ uploaded: 1, rejected: 2 });
    expect(
      dev.activity
        .filter((a) => a.type === "rejected")
        .map((a) => a.path)
        .sort(),
    ).toEqual(["badfolder ", "trailing "]);
    expect([...(await acc.web.tree()).keys()]).toEqual(["ok.txt"]);
    expect(existsSync(join(dev.dir, "trailing "))).toBe(true);
  });
});

describe("transfers", () => {
  it("runs at most two at a time", async () => {
    const acc = await newAccount(api);
    for (let i = 0; i < 8; i++) await acc.web.write(`f${String(i)}.bin`, "x".repeat(200_000));
    let running = 0;
    let peak = 0;
    const spy = new SpyApi(
      acc.client(),
      async (call) => {
        if (call !== "download") return;
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      (call) => {
        if (call === "download") running--;
      },
    );
    const dev = newDevice(api, acc, "Laptop", undefined, { api: spy });
    const result = await dev.sync();
    expect(result.downloaded).toBe(8);
    expect(peak).toBe(2);
  });

  it("uploads a multi-chunk file and a second device downloads the same bytes", async () => {
    const acc = await newAccount(api);
    const a = newDevice(api, acc, "Laptop");
    const big = randomBytes(400 * 1024);
    put(a.dir, "big.bin", big);
    await a.sync();
    const b = newDevice(api, acc, "Desktop");
    await b.sync();
    expect(readFileSync(join(b.dir, "big.bin")).equals(big)).toBe(true);
  });
});

describe("running", () => {
  it("syncs on file-system events and by polling, and pauses on request", async () => {
    const acc = await newAccount(api);
    const dev = newDevice(api, acc, "Laptop", undefined, { debounceMs: 50, pollMs: 300 });
    const statuses: SyncStatus[] = [];
    dev.engine.on("status", (s) => statuses.push(s));
    dev.engine.start();
    try {
      put(dev.dir, "watched.txt", "from disk");
      await waitFor(async () => (await acc.web.tree()).has("watched.txt"));

      await acc.web.write("polled.txt", "from web");
      await waitFor(() => existsSync(join(dev.dir, "polled.txt")));
      expect(text(dev.dir, "polled.txt")).toBe("from web");

      dev.engine.pause();
      expect(dev.engine.status.state).toBe("paused");
      put(dev.dir, "while-paused.txt", "later");
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect((await acc.web.tree()).has("while-paused.txt")).toBe(false);
      dev.engine.resume();
      await waitFor(async () => (await acc.web.tree()).has("while-paused.txt"));
      await waitFor(() => dev.engine.status.state === "idle");
    } finally {
      await dev.engine.stop();
    }
    expect(statuses.map((s) => s.state)).toEqual(
      expect.arrayContaining(["syncing", "idle", "paused"]),
    );
  });

  it("reports offline and rejected credentials as status, and keeps local files", async () => {
    const acc = await newAccount(api);
    const down = newDevice(api, acc, "Laptop", undefined, {
      api: new ApiClient("http://127.0.0.1:1", acc.token),
    });
    put(down.dir, "keep.txt", "keep");
    await expect(down.sync()).rejects.toBeInstanceOf(NetworkError);
    expect(down.engine.status).toEqual({ state: "offline" });

    const wrong = newDevice(api, acc, "Laptop", undefined, {
      api: new ApiClient(api.base, "cloud_not-a-real-token"),
    });
    put(wrong.dir, "keep.txt", "keep");
    await expect(wrong.sync()).rejects.toMatchObject({ status: 401 });
    expect(wrong.engine.status).toEqual({ state: "error", code: "unauthenticated" });
    expect(text(wrong.dir, "keep.txt")).toBe("keep");
  });
});
