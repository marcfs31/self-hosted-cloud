import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore, type SyncEntry } from "./state.js";

const file = (id: string): SyncEntry => ({
  fileId: id,
  kind: "file",
  remoteVersionId: `v-${id}`,
  size: 3,
  mtimeMs: 1234.5,
  sha256: "a".repeat(64),
});
const folder = (id: string): SyncEntry => ({
  fileId: id,
  kind: "folder",
  remoteVersionId: null,
  size: 0,
  mtimeMs: 0,
  sha256: null,
});

function fresh(): StateStore {
  return new StateStore(join(mkdtempSync(join(tmpdir(), "cloud-state-")), "nested", "state.json"));
}

describe("StateStore", () => {
  it("reports a missing file as such and starts empty", async () => {
    const store = fresh();
    expect(await store.load()).toBe("missing");
    expect(store.cursor).toBeNull();
    expect(store.entries.size).toBe(0);
  });

  it("round-trips cursor, root and entries and leaves no temp file behind", async () => {
    const store = fresh();
    store.setCursor("c1");
    store.setRootId("root");
    store.set("dir", folder("d"));
    store.set("dir/a.txt", file("a"));
    await store.save();

    const again = new StateStore(store.file);
    expect(await again.load()).toBe("loaded");
    expect(again.cursor).toBe("c1");
    expect(again.rootId).toBe("root");
    expect([...again.entries]).toEqual([...store.entries]);
    expect(readdirSync(join(store.file, ".."))).toEqual(["state.json"]);
  });

  it("coalesces concurrent saves into consistent writes of the latest state", async () => {
    const store = fresh();
    const saves: Promise<void>[] = [];
    for (let i = 0; i < 25; i++) {
      store.set(`f${String(i)}`, file(String(i)));
      saves.push(store.save());
    }
    await Promise.all(saves);
    const body = JSON.parse(readFileSync(store.file, "utf8")) as { entries: object };
    expect(Object.keys(body.entries)).toHaveLength(25);
  });

  it("quarantines a corrupt file and starts empty instead of failing or guessing", async () => {
    const store = fresh();
    store.set("a", file("a"));
    await store.save();
    writeFileSync(store.file, '{"version":1,"entries":{"a":');
    const again = new StateStore(store.file);
    expect(await again.load()).toBe("corrupt");
    expect(again.entries.size).toBe(0);
    const names = readdirSync(join(store.file, ".."));
    expect(names.some((n) => n.startsWith("state.json.corrupt-"))).toBe(true);
    expect(names).not.toContain("state.json");
  });

  it("drops malformed entries and entries whose parent folder is not an entry", async () => {
    const store = fresh();
    store.set("ok.txt", file("ok"));
    store.set("lost/child.txt", file("c"));
    store.set("dir", folder("d"));
    store.set("dir/inner.txt", file("i"));
    store.set("ok.txt/under-a-file.txt", file("x"));
    await store.save();
    const body = JSON.parse(readFileSync(store.file, "utf8")) as {
      entries: Record<string, unknown>;
    };
    body.entries["bad"] = { fileId: 1 };
    writeFileSync(store.file, JSON.stringify(body));

    const again = new StateStore(store.file);
    await again.load();
    expect([...again.entries.keys()].sort()).toEqual(["dir", "dir/inner.txt", "ok.txt"]);
  });

  it("rekeys a folder with everything under it, and deletes a tree by prefix only", () => {
    const store = fresh();
    store.set("a", folder("a"));
    store.set("a/x.txt", file("x"));
    store.set("ab", folder("ab"));
    store.rekey("a", "b");
    expect([...store.entries.keys()].sort()).toEqual(["ab", "b", "b/x.txt"]);
    store.deleteTree("b");
    expect([...store.entries.keys()]).toEqual(["ab"]);
  });
});
