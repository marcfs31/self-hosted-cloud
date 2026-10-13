import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { folderListing, trashListing, versionListing, type FileNode } from "@cloud/shared";
import { ApiClient, type SyncApi } from "../api/client.js";
import { SyncEngine, type SyncActivity, type SyncResult } from "../sync/engine.js";
import { baseOf, joinPath, parentOf } from "../sync/paths.js";
import type { LiveApi } from "./live-api.js";

let counter = 0;

export function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `cloud-desktop-${label}-`));
}

export function put(dir: string, rel: string, content: string | Buffer): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** Write and push the mtime a few seconds forward so the edit is visible even to a coarse clock. */
export function edit(dir: string, rel: string, content: string | Buffer): void {
  put(dir, rel, content);
  counter += 1;
  const when = new Date(Date.now() + counter * 3000);
  utimesSync(join(dir, rel), when, when);
}

export function text(dir: string, rel: string): string {
  return readFileSync(join(dir, rel), "utf8");
}

/** Every file (path → content) and folder (path/ → "") under a directory, sorted. */
export function snapshotDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = joinPath(rel, entry.name);
      if (entry.isDirectory()) {
        out[`${path}/`] = "";
        walk(path);
      } else {
        out[path] = readFileSync(join(dir, path), "utf8");
      }
    }
  };
  walk("");
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export interface Account {
  token: string;
  /** What the web UI would do: plain API calls, independent of any engine. */
  web: Web;
  client: () => ApiClient;
}

export interface RemoteItem {
  id: string;
  kind: "file" | "folder";
  versionCount: number;
  versionId: string | null;
}

export class Web {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  private get(path: string): Promise<Response> {
    return fetch(`${this.base}${path}`, { headers: { Authorization: `Bearer ${this.token}` } });
  }

  private client(): ApiClient {
    return new ApiClient(this.base, this.token, 64 * 1024);
  }

  async listing(id?: string): Promise<{ folder: FileNode; children: FileNode[] }> {
    const res = await this.get(id === undefined ? "/api/files/root" : `/api/folders/${id}`);
    return folderListing.parse(await res.json());
  }

  /** Whole remote tree: path → item (folders included). */
  async tree(): Promise<Map<string, RemoteItem>> {
    const out = new Map<string, RemoteItem>();
    const walk = async (id: string | undefined, rel: string): Promise<void> => {
      for (const child of (await this.listing(id)).children) {
        const path = joinPath(rel, child.name);
        out.set(path, {
          id: child.id,
          kind: child.kind,
          versionCount: child.versionCount,
          versionId: child.currentVersionId,
        });
        if (child.kind === "folder") await walk(child.id, path);
      }
    };
    await walk(undefined, "");
    return out;
  }

  async item(path: string): Promise<RemoteItem> {
    const found = (await this.tree()).get(path);
    if (!found) throw new Error(`remote ${path} not found`);
    return found;
  }

  async content(path: string): Promise<string> {
    const item = await this.item(path);
    const res = await this.get(`/api/files/${item.id}/content?download=1`);
    return res.text();
  }

  async trashNames(): Promise<string[]> {
    const res = await this.get("/api/trash");
    return trashListing.parse(await res.json()).items.map((i) => i.name);
  }

  async versionCount(path: string): Promise<number> {
    const item = await this.item(path);
    const res = await this.get(`/api/files/${item.id}/versions`);
    return versionListing.parse(await res.json()).versions.length;
  }

  private async folderId(dir: string): Promise<string> {
    let id = (await this.listing()).folder.id;
    for (const name of dir === "" ? [] : dir.split("/")) {
      const found = (await this.listing(id)).children.find(
        (c) => c.name === name && c.kind === "folder",
      );
      id = found ? found.id : (await this.client().createFolder(id, name)).id;
    }
    return id;
  }

  async mkdir(path: string): Promise<void> {
    await this.folderId(path);
  }

  /** Create or replace a file (a replacement becomes a new version). */
  async write(path: string, content: string | Buffer): Promise<void> {
    const tmp = tempDir("web");
    const local = join(tmp, "payload");
    writeFileSync(local, content);
    const parentId = await this.folderId(parentOf(path));
    const existing = (await this.tree()).get(path);
    await this.client().upload({
      path: local,
      size: Buffer.byteLength(content),
      name: baseOf(path),
      parentId,
      ...(existing && { replaceId: existing.id }),
    });
    await rm(tmp, { recursive: true });
  }

  async rename(path: string, newName: string): Promise<void> {
    await this.client().rename((await this.item(path)).id, { name: newName });
  }

  async move(path: string, newParent: string): Promise<void> {
    await this.client().rename((await this.item(path)).id, {
      parentId: await this.folderId(newParent),
    });
  }

  async trash(path: string): Promise<void> {
    await this.client().trash((await this.item(path)).id);
  }
}

export async function newAccount(api: LiveApi): Promise<Account> {
  counter += 1;
  const { token } = await api.member(`user${String(counter)}-${String(Date.now())}@example.com`);
  return {
    token,
    web: new Web(api.base, token),
    client: () => new ApiClient(api.base, token, 64 * 1024),
  };
}

export interface Device {
  name: string;
  /** The synced folder. */
  dir: string;
  dataDir: string;
  stateFile: string;
  engine: SyncEngine;
  activity: SyncActivity[];
  sync: () => Promise<SyncResult>;
  /** A brand-new engine over the same folder and state file (a restarted app). */
  restart: () => Device;
}

export function newDevice(
  api: LiveApi,
  account: Account,
  name = "Laptop",
  existing?: { dir: string; dataDir: string },
  extra: { debounceMs?: number; pollMs?: number; api?: SyncApi } = {},
): Device {
  const dir = existing?.dir ?? tempDir(`${name}-sync`);
  const dataDir = existing?.dataDir ?? tempDir(`${name}-data`);
  const stateFile = join(dataDir, "state.json");
  const activity: SyncActivity[] = [];
  const engine = new SyncEngine({
    api: extra.api ?? new ApiClient(api.base, account.token, 64 * 1024),
    localRoot: dir,
    stateFile,
    clock: { now: () => Date.now() },
    deviceName: name,
    ...(extra.debounceMs !== undefined && { debounceMs: extra.debounceMs }),
    ...(extra.pollMs !== undefined && { pollMs: extra.pollMs }),
  });
  engine.on("activity", (a) => activity.push(a));
  const device: Device = {
    name,
    dir,
    dataDir,
    stateFile,
    engine,
    activity,
    sync: () => engine.syncOnce(),
    restart: () => newDevice(api, account, name, { dir, dataDir }, extra),
  };
  return device;
}

export async function waitFor(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > until) throw new Error("timed out waiting for a condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export type CallName = keyof SyncApi;

/** Delegates to a real client; `before` runs ahead of every call (to count, delay or break them). */
export class SpyApi implements SyncApi {
  constructor(
    private readonly inner: SyncApi,
    private readonly before: (call: CallName) => Promise<void> | void,
    private readonly after: (call: CallName) => void = () => undefined,
  ) {}

  private async wrap<T>(call: CallName, run: () => Promise<T>): Promise<T> {
    await this.before(call);
    try {
      return await run();
    } finally {
      this.after(call);
    }
  }

  root: SyncApi["root"] = () => this.wrap("root", () => this.inner.root());
  changes: SyncApi["changes"] = (c) => this.wrap("changes", () => this.inner.changes(c));
  listFolder: SyncApi["listFolder"] = (id) =>
    this.wrap("listFolder", () => this.inner.listFolder(id));
  createFolder: SyncApi["createFolder"] = (p, n) =>
    this.wrap("createFolder", () => this.inner.createFolder(p, n));
  rename: SyncApi["rename"] = (id, patch) =>
    this.wrap("rename", () => this.inner.rename(id, patch));
  trash: SyncApi["trash"] = (id) => this.wrap("trash", () => this.inner.trash(id));
  versions: SyncApi["versions"] = (id) => this.wrap("versions", () => this.inner.versions(id));
  upload: SyncApi["upload"] = (r) => this.wrap("upload", () => this.inner.upload(r));
  download: SyncApi["download"] = (id, v, t) =>
    this.wrap("download", () => this.inner.download(id, v, t));
}
