import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { uniqueName, type FileKind, type FileNode } from "@cloud/shared";
import { ApiError, NetworkError, type SyncApi } from "../api/client.js";
import { isIgnoredPath, TEMP_PREFIX } from "./ignore.js";
import { baseOf, conflictedName, depthOf, isUnder, joinPath, parentOf } from "./paths.js";
import { RemoteTree, type RemoteNode } from "./remote.js";
import { scanLocal, type LocalItem, type Scan } from "./scan.js";
import { sha256File } from "./fsops.js";
import type { StateStore, SyncEntry } from "./state.js";

export type ActivityType =
  | "upload"
  | "download"
  | "mkdir-local"
  | "mkdir-remote"
  | "rename-local"
  | "rename-remote"
  | "trash-remote"
  | "trash-local"
  | "conflict"
  | "rejected"
  | "error";

export interface SyncActivity {
  type: ActivityType;
  /** Sync-root-relative path (the original path for a conflict; `to` is the conflicted copy). */
  path: string;
  phase: "start" | "done" | "failed";
  /** A machine code for the shell to translate: an API error code, an errno or one of ours. */
  code?: string;
  to?: string;
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  renamed: number;
  trashedRemote: number;
  trashedLocal: number;
  conflicts: number;
  rejected: number;
  errors: number;
}

export function emptyResult(): SyncResult {
  return {
    uploaded: 0,
    downloaded: 0,
    renamed: 0,
    trashedRemote: 0,
    trashedLocal: 0,
    conflicts: 0,
    rejected: 0,
    errors: 0,
  };
}

/** A condition the whole sync cannot proceed under (as opposed to one failing file). */
export class SyncError extends Error {
  constructor(readonly code: "account_changed" | "local_root_missing") {
    super(code);
    this.name = "SyncError";
  }
}

/** The file changed under us; the action is dropped and the next pass sees the new state. */
class Changed extends Error {
  constructor() {
    super("changed_during_sync");
    this.name = "Changed";
  }
}

export interface PassEnv {
  api: SyncApi;
  localRoot: string;
  /** Absolute paths the scan must never enter (the app's own data dir when it sits inside the root). */
  skipAbs: readonly string[];
  store: StateStore;
  now: () => number;
  deviceName: string;
  trashItem: (abs: string) => Promise<void>;
  concurrency: number;
  activity: (activity: SyncActivity) => void;
}

interface Action {
  /** 0 bookkeeping, 1 folders, 2 transfers, 3 single deletions, 4 folder deletions (deepest first). */
  phase: 0 | 1 | 2 | 3 | 4;
  path: string;
  type: ActivityType | null;
  /** Failing leaves a remote change unapplied, so the feed cursor must not move past it. */
  remoteDerived: boolean;
  to?: string;
  run: () => Promise<void>;
}

const RACY_MS = 2000;

function isFatal(err: unknown): err is NetworkError | ApiError {
  return err instanceof NetworkError || (err instanceof ApiError && err.status === 401);
}

/** Failures that retrying cannot fix (the name cannot exist on this file system). */
function isPermanent(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EINVAL" || code === "ENAMETOOLONG";
}

function codeOf(err: unknown): string {
  if (err instanceof ApiError) return err.code ?? `http_${String(err.status)}`;
  if (err instanceof NetworkError) return "network";
  if (err instanceof Changed) return "changed_during_sync";
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : "unknown";
}

async function statOf(
  abs: string,
): Promise<{ kind: FileKind; size: number; mtimeMs: number } | undefined> {
  try {
    const st = await lstat(abs);
    return { kind: st.isDirectory() ? "folder" : "file", size: st.size, mtimeMs: st.mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * One reconciliation: pull the change feed, scan the local folder, then three-way merge each
 * path (last synced state / local / remote). Deletions are only ever derived from an entry that
 * proves the item was in sync before, so a lost or stale state file causes copies, never deletes.
 */
export class SyncPass {
  readonly result = emptyResult();
  /** Run another pass: something was left for the next scan (a renamed conflicting folder). */
  rerun = false;

  private readonly store: StateStore;
  private readonly entries: Map<string, SyncEntry>;
  private rootId = "";
  private tree = new RemoteTree("");
  private remote = new Map<string, RemoteNode>();
  private nextCursor: string | undefined;
  private scan: Scan = {
    items: new Map(),
    actual: new Map(),
    rejected: new Set(),
    unreadable: new Set(),
  };
  private local = new Map<string, LocalItem>();
  private readonly shaCache = new Map<string, { sha: string; size: number; mtimeMs: number }>();
  private readonly remoteShaCache = new Map<string, string>();
  private readonly ensuring = new Map<string, Promise<string>>();
  private readonly actions: Action[] = [];
  private readonly skipPrefixes: string[] = [];
  private readonly claimedLower = new Set<string>();
  private readonly localLower = new Map<string, string>();
  private blockCursor = false;
  private fatal: Error | undefined;

  constructor(private readonly env: PassEnv) {
    this.store = env.store;
    this.entries = env.store.entries;
  }

  async run(): Promise<void> {
    const root = await this.env.api.root();
    if (this.store.rootId !== null && this.store.rootId !== root.id) {
      throw new SyncError("account_changed");
    }
    this.rootId = root.id;
    this.store.setRootId(root.id);

    await this.pull();
    await this.applyRemoteMoves();
    this.scan = await scanLocal(this.env.localRoot, {
      skipAbs: this.env.skipAbs,
      now: this.env.now(),
    }).catch((err: unknown) => {
      if (
        (err as NodeJS.ErrnoException).code === "ENOENT" ||
        (err as NodeJS.ErrnoException).code === "ENOTDIR"
      ) {
        throw new SyncError("local_root_missing");
      }
      throw err;
    });
    this.local = this.scan.items;
    for (const path of this.scan.rejected) this.reject(path, "invalid_name");

    this.remote = this.tree.index();
    await this.detectLocalRenames();
    this.remote = this.tree.index();

    await this.plan();
    await this.execute();

    if (this.fatal === undefined && !this.blockCursor && this.nextCursor !== undefined) {
      this.store.setCursor(this.nextCursor);
    }
    await this.store.save();
    if (this.fatal !== undefined) throw this.fatal;
  }

  // ---------------------------------------------------------------- pull

  private async pull(): Promise<void> {
    let cursor = this.store.cursor ?? undefined;
    for (;;) {
      this.tree =
        cursor === undefined
          ? new RemoteTree(this.rootId)
          : RemoteTree.fromEntries(this.rootId, this.entries);
      try {
        for (;;) {
          const page = await this.env.api.changes(cursor);
          this.tree.apply(page.changes);
          cursor = page.cursor;
          if (!page.hasMore) break;
        }
      } catch (err) {
        // A cursor this server does not know (restored database): a snapshot is always safe.
        if (
          err instanceof ApiError &&
          err.code === "invalid_request" &&
          this.store.cursor !== null &&
          cursor !== undefined
        ) {
          cursor = undefined;
          this.store.cursor = null;
          continue;
        }
        throw err;
      }
      this.nextCursor = cursor;
      return;
    }
  }

  // ------------------------------------------- remote rename/move → local

  private abs(key: string): string {
    return join(this.env.localRoot, this.scan.actual.get(key) ?? key);
  }

  private async applyRemoteMoves(): Promise<void> {
    const attempted = new Set<string>();
    for (;;) {
      const next = this.findRemoteMove(attempted);
      if (!next) return;
      const { path, entry, newPath } = next;
      attempted.add(entry.fileId);
      const src = join(this.env.localRoot, path);
      const dst = join(this.env.localRoot, newPath);
      try {
        await this.assertInsideRoot(src);
        await this.assertInsideRoot(dst);
        const from = await statOf(src);
        if (from?.kind !== entry.kind) continue;
        const to = await statOf(dst);
        if (to !== undefined) {
          const [a, b] = await Promise.all([lstat(src), lstat(dst)]);
          if (a.ino !== b.ino || a.dev !== b.dev || path.toLowerCase() !== newPath.toLowerCase())
            continue;
        }
        await mkdir(dirname(dst), { recursive: true });
        await rename(src, dst);
        this.store.rekey(path, newPath);
        this.adoptAncestors(entry.fileId);
        this.result.renamed++;
        this.env.activity({ type: "rename-local", path, to: newPath, phase: "done" });
        await this.store.save();
      } catch (err) {
        if (isFatal(err)) throw err;
        this.fail("rename-local", path, err, true);
      }
    }
  }

  private findRemoteMove(
    attempted: ReadonlySet<string>,
  ): { path: string; entry: SyncEntry; newPath: string } | undefined {
    const byDepth = [...this.entries].sort((a, b) => depthOf(a[0]) - depthOf(b[0]));
    for (const [path, entry] of byDepth) {
      if (attempted.has(entry.fileId)) continue;
      const node = this.tree.nodes.get(entry.fileId);
      if (!node) continue;
      const parent = parentOf(path);
      const parentId = parent === "" ? this.rootId : this.entries.get(parent)?.fileId;
      if (node.parentId === parentId && node.name === baseOf(path)) continue;
      const newPath = this.tree.pathOf(node.id);
      if (newPath === null || newPath === path || isIgnoredPath(newPath)) continue;
      return { path, entry, newPath };
    }
    return undefined;
  }

  /** After a move, every folder above the new location is an existing synced folder. */
  private adoptAncestors(fileId: string): void {
    let node = this.tree.nodes.get(fileId);
    const chain: RemoteNode[] = [];
    while (node?.parentId != null && node.parentId !== this.rootId) {
      node = this.tree.nodes.get(node.parentId);
      if (node) chain.push(node);
    }
    for (const folder of chain) {
      const path = this.tree.pathOf(folder.id);
      if (path === null || path === "" || this.entries.has(path)) continue;
      this.store.set(path, {
        fileId: folder.id,
        kind: "folder",
        remoteVersionId: null,
        size: 0,
        mtimeMs: 0,
        sha256: null,
      });
    }
  }

  // ------------------------------------------- local rename → remote rename

  private racy(mtimeMs: number): number {
    return this.env.now() - mtimeMs < RACY_MS ? -1 : mtimeMs;
  }

  private async hashLocal(key: string): Promise<string> {
    const abs = this.abs(key);
    const before = await lstat(abs);
    const cached = this.shaCache.get(key);
    if (cached?.size === before.size && cached.mtimeMs === before.mtimeMs) return cached.sha;
    const sha = await sha256File(abs);
    const after = await lstat(abs);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Changed();
    this.shaCache.set(key, { sha, size: after.size, mtimeMs: after.mtimeMs });
    this.local.set(key, { kind: "file", size: after.size, mtimeMs: after.mtimeMs });
    return sha;
  }

  private async detectLocalRenames(): Promise<void> {
    const gone: [string, SyncEntry][] = [];
    for (const [path, entry] of this.entries) {
      if (entry.kind !== "file" || entry.sha256 === null || this.local.has(path)) continue;
      if (this.underUnreadable(path)) continue;
      const node = this.remote.get(path);
      if (node?.id !== entry.fileId || node.versionId !== entry.remoteVersionId) continue;
      gone.push([path, entry]);
    }
    if (gone.length === 0) return;
    const sizes = new Set(gone.map(([, entry]) => entry.size));
    const taken = new Set<string>();
    const appeared = [...this.local]
      .filter(
        ([path, item]) =>
          item.kind === "file" &&
          sizes.has(item.size) &&
          !this.entries.has(path) &&
          !this.remote.has(path),
      )
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (const [newPath, item] of appeared) {
      try {
        const sha = await this.hashLocal(newPath);
        const match = gone.find(
          ([path, entry]) => !taken.has(path) && entry.size === item.size && entry.sha256 === sha,
        );
        if (!match) continue;
        const [oldPath, entry] = match;
        taken.add(oldPath);
        await this.moveRemote(oldPath, newPath, entry);
      } catch (err) {
        if (isFatal(err)) throw err;
        this.fail("rename-remote", newPath, err, false);
      }
    }
    await this.store.save();
  }

  private async moveRemote(oldPath: string, newPath: string, entry: SyncEntry): Promise<void> {
    const node = this.tree.nodes.get(entry.fileId);
    if (!node) return;
    const parentId = await this.ensureRemoteDir(parentOf(newPath));
    const name = baseOf(newPath);
    const patch: { name?: string; parentId?: string } = {};
    if (node.name !== name) patch.name = name;
    if (node.parentId !== parentId) patch.parentId = parentId;
    this.env.activity({ type: "rename-remote", path: oldPath, to: newPath, phase: "start" });
    try {
      await this.env.api.rename(entry.fileId, patch);
    } catch (err) {
      if (
        err instanceof ApiError &&
        ["name_conflict", "invalid_move", "not_found"].includes(err.code ?? "")
      ) {
        // Leave it to the ordinary rules: the old path is trashed, the new one uploaded or adopted.
        this.env.activity({
          type: "rename-remote",
          path: oldPath,
          to: newPath,
          phase: "failed",
          code: err.code ?? "",
        });
        return;
      }
      throw err;
    }
    node.name = name;
    node.parentId = parentId;
    const item = this.local.get(newPath);
    this.store.delete(oldPath);
    this.store.set(newPath, {
      ...entry,
      mtimeMs: item ? this.racy(item.mtimeMs) : -1,
      size: item?.size ?? entry.size,
    });
    this.result.renamed++;
    this.env.activity({ type: "rename-remote", path: oldPath, to: newPath, phase: "done" });
  }

  // ---------------------------------------------------------------- planning

  private underUnreadable(path: string): boolean {
    for (const dir of this.scan.unreadable) if (path === dir || isUnder(path, dir)) return true;
    return false;
  }

  private underRejected(path: string): boolean {
    for (const dir of this.scan.rejected) if (path === dir || isUnder(path, dir)) return true;
    return false;
  }

  private reject(path: string, code: string): void {
    this.result.rejected++;
    this.env.activity({ type: "rejected", path, phase: "failed", code });
  }

  private act(
    phase: Action["phase"],
    path: string,
    type: ActivityType | null,
    remoteDerived: boolean,
    run: () => Promise<void>,
    to?: string,
  ): void {
    this.actions.push({ phase, path, type, remoteDerived, run, ...(to !== undefined && { to }) });
  }

  private async plan(): Promise<void> {
    for (const key of this.local.keys()) this.localLower.set(key.toLowerCase(), key);
    const keys = new Set<string>([
      ...this.entries.keys(),
      ...this.local.keys(),
      ...this.remote.keys(),
    ]);
    for (const key of [...keys].sort()) {
      if (isIgnoredPath(key) || this.underUnreadable(key)) continue;
      if (this.skipPrefixes.some((prefix) => isUnder(key, prefix))) continue;
      try {
        const base = this.entries.get(key);
        const local = this.local.get(key);
        const remote = this.remote.get(key);
        if (base) await this.decideWithBase(key, base, local, remote);
        else this.decideFresh(key, local, remote);
      } catch (err) {
        if (isFatal(err)) throw err;
        this.fail(null, key, err, true);
      }
    }
  }

  private async localChanged(key: string, entry: SyncEntry): Promise<boolean> {
    const item = this.local.get(key);
    if (!item || item.kind !== entry.kind) return true;
    if (entry.kind === "folder") return false;
    if (item.size === entry.size && item.mtimeMs === entry.mtimeMs) return false;
    if (item.size !== entry.size) return true;
    const sha = await this.hashLocal(key);
    const fresh = this.local.get(key);
    if (fresh?.size !== entry.size) return true;
    if (sha !== entry.sha256) return true;
    this.store.set(key, { ...entry, mtimeMs: this.racy(fresh.mtimeMs) });
    return false;
  }

  private static remoteChanged(entry: SyncEntry, node: RemoteNode): boolean {
    return node.kind === "file" && node.versionId !== entry.remoteVersionId;
  }

  private async remoteSha(node: RemoteNode): Promise<string> {
    const cached = this.remoteShaCache.get(node.id);
    if (cached !== undefined && node.versionId !== null) return cached;
    const versions = await this.env.api.versions(node.id);
    const version = versions.find((v) => v.id === node.versionId);
    if (!version) throw new ApiError(404, "not_found");
    this.remoteShaCache.set(node.id, version.sha256);
    return version.sha256;
  }

  /** Same name, different case: a case-insensitive disk cannot hold both, so never create the second. */
  private caseClash(key: string): boolean {
    const lower = key.toLowerCase();
    const other = this.localLower.get(lower);
    if ((other !== undefined && other !== key) || this.claimedLower.has(lower)) return true;
    this.claimedLower.add(lower);
    return false;
  }

  private decideFresh(
    key: string,
    local: LocalItem | undefined,
    remote: RemoteNode | undefined,
  ): void {
    if (local && !remote) {
      if (local.kind === "folder") this.planMkdirRemote(key);
      else this.planUpload(key);
    } else if (!local && remote) {
      this.planCreateLocal(key, remote);
    } else if (local && remote) {
      if (local.kind === "folder" && remote.kind === "folder") this.planAdoptFolder(key, remote);
      else if (local.kind === "file" && remote.kind === "file")
        this.planCompare(key, local, remote);
      else this.planConflict(key, local, remote);
    }
  }

  private planCompare(key: string, local: LocalItem, remote: RemoteNode): void {
    this.act(2, key, null, true, async () => {
      // Same bytes on both sides adopts the pair; anything else keeps both.
      const same = local.size === remote.size && (await this.sameContent(key, remote));
      if (same) await this.adoptFile(key, remote);
      else await this.doConflict(key, local, remote);
    });
  }

  private async sameContent(key: string, remote: RemoteNode): Promise<boolean> {
    const [theirs, ours] = [await this.remoteSha(remote), await this.hashLocal(key)];
    return theirs === ours;
  }

  private async adoptFile(key: string, remote: RemoteNode): Promise<void> {
    const sha = await this.hashLocal(key);
    const item = this.local.get(key);
    this.requireParent(key);
    this.store.set(key, {
      fileId: remote.id,
      kind: "file",
      remoteVersionId: remote.versionId,
      size: item?.size ?? remote.size,
      mtimeMs: item ? this.racy(item.mtimeMs) : -1,
      sha256: sha,
    });
  }

  private planAdoptFolder(key: string, remote: RemoteNode): void {
    this.act(0, key, null, true, () => {
      this.requireParent(key);
      this.store.set(key, {
        fileId: remote.id,
        kind: "folder",
        remoteVersionId: null,
        size: 0,
        mtimeMs: 0,
        sha256: null,
      });
      return Promise.resolve();
    });
  }

  private planCreateLocal(key: string, remote: RemoteNode): void {
    if (this.caseClash(key)) {
      this.reject(key, "case_collision");
      return;
    }
    if (remote.kind === "folder") {
      this.act(1, key, "mkdir-local", true, () => this.doMkdirLocal(key, remote));
    } else {
      this.act(2, key, "download", true, () => this.doDownload(key, remote, undefined));
    }
  }

  private planMkdirRemote(key: string): void {
    this.act(1, key, "mkdir-remote", false, async () => {
      this.requireParent(key);
      await this.ensureRemoteDir(key);
    });
  }

  private planUpload(key: string, replace?: { fileId: string; parentId: string }): void {
    this.act(2, key, "upload", false, () => this.doUpload(key, replace));
  }

  /**
   * A file against a folder: this creates the folder (or renames the local one), so it runs before
   * any transfer into it, and the local folder's contents wait for the next scan.
   */
  private planConflict(key: string, local: LocalItem, remote: RemoteNode): void {
    const kindClash = local.kind !== remote.kind;
    if (local.kind === "folder" && kindClash) this.skipPrefixes.push(key);
    this.act(kindClash ? 1 : 2, key, "conflict", true, () => this.doConflict(key, local, remote));
  }

  /** The server replaced the item by one of the other kind and nothing local changed: swap it. */
  private async planReplaceKind(key: string, local: LocalItem, remote: RemoteNode): Promise<void> {
    if (local.kind === "folder") {
      if (await this.subtreeLocalNews(key)) {
        this.planConflict(key, local, remote);
        return;
      }
      this.skipPrefixes.push(key);
    }
    this.act(1, key, "trash-local", true, async () => {
      await this.doTrashLocal(key, local, local.kind === "folder");
      if (remote.kind === "folder") await this.doMkdirLocal(key, remote);
      else await this.doDownload(key, remote, undefined);
    });
  }

  private planDrop(key: string): void {
    this.act(0, key, null, false, () => {
      this.store.delete(key);
      return Promise.resolve();
    });
  }

  private async decideWithBase(
    key: string,
    base: SyncEntry,
    local: LocalItem | undefined,
    remote: RemoteNode | undefined,
  ): Promise<void> {
    // The remote path now holds a different item than the one we synced: the old one is gone.
    if (remote && remote.id !== base.fileId) {
      const unchanged = local !== undefined && !(await this.localChanged(key, base));
      if (!local) this.decideFresh(key, undefined, remote);
      else if (unchanged && local.kind === "file" && remote.kind === "file") {
        this.act(2, key, "download", true, () => this.doDownload(key, remote, local));
      } else if (unchanged && local.kind === "folder" && remote.kind === "folder") {
        this.planAdoptFolder(key, remote);
      } else if (unchanged && local.kind !== remote.kind) {
        await this.planReplaceKind(key, local, remote);
      } else this.decideFresh(key, local, remote);
      return;
    }

    // Local replaced the item by one of the other kind (file ↔ folder).
    if (local && local.kind !== base.kind) {
      if (remote && !SyncPass.remoteChanged(base, remote)) {
        const fileId = base.fileId;
        this.act(3, key, "trash-remote", false, async () => {
          await this.trashRemoteNode(fileId);
          this.store.deleteTree(key);
        });
        this.rerun = true;
      } else if (remote) {
        this.decideFresh(key, local, remote);
      } else {
        this.planDrop(key);
        this.decideFresh(key, local, undefined);
      }
      return;
    }

    if (!local && !remote) {
      this.planDrop(key);
      return;
    }

    if (base.kind === "folder") {
      await this.decideFolder(key, base, local, remote);
      return;
    }

    if (!local && remote) {
      if (SyncPass.remoteChanged(base, remote)) {
        // Edit beats delete: the file comes back.
        this.act(2, key, "download", true, () => this.doDownload(key, remote, undefined));
      } else {
        const fileId = base.fileId;
        this.act(3, key, "trash-remote", false, async () => {
          await this.trashRemoteNode(fileId);
          this.store.delete(key);
        });
      }
      return;
    }

    if (local && !remote) {
      if (await this.localChanged(key, base)) {
        // Edit beats delete: the local file goes up again as a new file.
        this.planDrop(key);
        this.planUpload(key);
      } else {
        this.act(3, key, "trash-local", true, () => this.doTrashLocal(key, local, false));
      }
      return;
    }

    if (local && remote) {
      const localChanged = await this.localChanged(key, base);
      const remoteChanged = SyncPass.remoteChanged(base, remote);
      if (localChanged && !remoteChanged) {
        this.planUpload(key, { fileId: base.fileId, parentId: remote.parentId ?? this.rootId });
      } else if (!localChanged && remoteChanged) {
        this.act(2, key, "download", true, () => this.doDownload(key, remote, local));
      } else if (localChanged && remoteChanged) {
        this.planCompare(key, local, remote);
      }
    }
  }

  private async decideFolder(
    key: string,
    base: SyncEntry,
    local: LocalItem | undefined,
    remote: RemoteNode | undefined,
  ): Promise<void> {
    if (!local && remote) {
      // Deleted locally. If anything under it changed remotely, the folder stays and the changes win.
      if (this.subtreeRemoteNews(key)) {
        this.act(1, key, "mkdir-local", true, () => this.doMkdirLocal(key, remote));
      } else {
        this.skipPrefixes.push(key);
        this.act(4, key, "trash-remote", false, async () => {
          await this.trashRemoteNode(base.fileId);
          this.store.deleteTree(key);
        });
      }
      return;
    }
    if (local && !remote) {
      // Deleted remotely. Local additions or edits under it keep it alive (and uploaded again).
      if (await this.subtreeLocalNews(key)) {
        this.planDrop(key);
        this.decideFresh(key, local, undefined);
      } else {
        this.skipPrefixes.push(key);
        this.act(4, key, "trash-local", true, () => this.doTrashLocal(key, local, true));
      }
    }
  }

  private subtreeRemoteNews(key: string): boolean {
    for (const [path, node] of this.remote) {
      if (!isUnder(path, key)) continue;
      const entry = this.entries.get(path);
      if (!entry || entry.fileId !== node.id || SyncPass.remoteChanged(entry, node)) return true;
    }
    return false;
  }

  private async subtreeLocalNews(key: string): Promise<boolean> {
    if (this.underRejected(key)) return true;
    for (const dir of this.scan.rejected) if (isUnder(dir, key)) return true;
    for (const dir of this.scan.unreadable) if (isUnder(dir, key)) return true;
    for (const [path, item] of this.local) {
      if (!isUnder(path, key)) continue;
      const entry = this.entries.get(path);
      if (!entry || item.kind !== entry.kind) return true;
      if (await this.localChanged(path, entry)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- execution

  private async execute(): Promise<void> {
    const byPhase = (phase: Action["phase"]): Action[] =>
      this.actions
        .filter((a) => a.phase === phase)
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const action of byPhase(0)) await this.runAction(action);
    for (const action of byPhase(1)) await this.runAction(action);
    await this.runPool(byPhase(2));
    await this.runPool(byPhase(3));
    for (const action of byPhase(4).reverse()) await this.runAction(action);
  }

  private async runPool(actions: Action[]): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const action = actions[next++];
        if (action === undefined || this.fatal !== undefined) return;
        await this.runAction(action);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.env.concurrency, actions.length) }, worker),
    );
  }

  private activityFor(action: Action, phase: SyncActivity["phase"], code?: string): void {
    if (action.type === null && phase !== "failed") return;
    this.env.activity({
      type: action.type ?? "error",
      path: action.path,
      phase,
      ...(code !== undefined && { code }),
      ...(action.to !== undefined && { to: action.to }),
    });
  }

  private async runAction(action: Action): Promise<void> {
    if (this.fatal !== undefined) return;
    this.activityFor(action, "start");
    try {
      await action.run();
    } catch (err) {
      if (isFatal(err)) {
        this.fatal = err;
        this.activityFor(action, "failed", codeOf(err));
        return;
      }
      this.activityFor(action, "failed", codeOf(err));
      this.noteFailure(err, action.remoteDerived);
      return;
    }
    this.activityFor(action, "done");
    try {
      await this.store.save();
    } catch (err) {
      this.fatal = err instanceof Error ? err : new Error(String(err));
    }
  }

  private noteFailure(err: unknown, remoteDerived: boolean): void {
    if (!(err instanceof Changed)) this.result.errors++;
    if (remoteDerived && !isPermanent(err)) this.blockCursor = true;
  }

  private fail(
    type: ActivityType | null,
    path: string,
    err: unknown,
    remoteDerived: boolean,
  ): void {
    this.env.activity({ type: type ?? "error", path, phase: "failed", code: codeOf(err) });
    this.noteFailure(err, remoteDerived);
  }

  // ---------------------------------------------------------------- actions

  private requireParent(key: string): void {
    const parent = parentOf(key);
    if (parent !== "" && this.entries.get(parent)?.kind !== "folder") {
      throw Object.assign(new Error("parent_missing"), { code: "parent_missing" });
    }
  }

  private async assertTarget(key: string, expected: LocalItem | undefined): Promise<void> {
    const now = await statOf(this.abs(key));
    if (expected === undefined) {
      if (now !== undefined) throw new Changed();
    } else if (now?.size !== expected.size || now.mtimeMs !== expected.mtimeMs) {
      throw new Changed();
    }
  }

  /**
   * Backstop for every local write: each existing ancestor below the sync root must be a real
   * folder. A symlink there (planted, or made by the user after the scan) would send the write
   * outside the sync folder.
   */
  private async assertInsideRoot(abs: string): Promise<void> {
    const parts = relative(this.env.localRoot, dirname(abs)).split(sep).filter(Boolean);
    let current = this.env.localRoot;
    for (const part of parts) {
      current = join(current, part);
      let st;
      try {
        st = await lstat(current);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      if (!st.isDirectory()) {
        throw Object.assign(new Error("unsafe_path"), { code: "unsafe_path" });
      }
    }
  }

  private async doMkdirLocal(key: string, remote: RemoteNode): Promise<void> {
    this.requireParent(key);
    await this.assertInsideRoot(this.abs(key));
    await mkdir(this.abs(key), { recursive: true });
    this.store.set(key, {
      fileId: remote.id,
      kind: "folder",
      remoteVersionId: null,
      size: 0,
      mtimeMs: 0,
      sha256: null,
    });
  }

  private async doDownload(
    key: string,
    remote: RemoteNode,
    expected: LocalItem | undefined,
  ): Promise<void> {
    if (remote.versionId === null) throw new ApiError(404, "not_found");
    this.requireParent(key);
    await this.assertInsideRoot(this.abs(key));
    const target = this.abs(key);
    const tmp = join(dirname(target), `${TEMP_PREFIX}${randomUUID()}`);
    const { size, sha256 } = await this.env.api.download(remote.id, remote.versionId, tmp);
    try {
      if (size !== remote.size)
        throw Object.assign(new Error("size_mismatch"), { code: "size_mismatch" });
      await this.assertTarget(key, expected);
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    const st = await lstat(target);
    this.store.set(key, {
      fileId: remote.id,
      kind: "file",
      remoteVersionId: remote.versionId,
      size: st.size,
      mtimeMs: this.racy(st.mtimeMs),
      sha256,
    });
    this.local.set(key, { kind: "file", size: st.size, mtimeMs: st.mtimeMs });
    this.result.downloaded++;
  }

  private async doUpload(
    key: string,
    replace: { fileId: string; parentId: string } | undefined,
  ): Promise<void> {
    this.requireParent(key);
    const parentId = replace?.parentId ?? (await this.ensureRemoteDir(parentOf(key)));
    const abs = this.abs(key);
    const before = await lstat(abs);
    const fileId = await this.env.api.upload({
      path: abs,
      size: before.size,
      name: baseOf(key),
      parentId,
      ...(replace !== undefined && { replaceId: replace.fileId }),
    });
    const current = (await this.env.api.versions(fileId)).find((v) => v.current);
    if (!current) throw new ApiError(404, "not_found");
    const after = await statOf(abs);
    const stable = after?.size === before.size && after.mtimeMs === before.mtimeMs;
    this.store.set(key, {
      fileId,
      kind: "file",
      remoteVersionId: current.id,
      size: current.size,
      mtimeMs: stable ? this.racy(before.mtimeMs) : -1,
      sha256: current.sha256,
    });
    this.result.uploaded++;
  }

  private async trashRemoteNode(fileId: string): Promise<void> {
    try {
      await this.env.api.trash(fileId);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "not_found")) throw err;
    }
    this.tree.nodes.delete(fileId);
    this.result.trashedRemote++;
  }

  private async doTrashLocal(key: string, expected: LocalItem, tree: boolean): Promise<void> {
    await this.assertInsideRoot(this.abs(key));
    if (expected.kind === "file") await this.assertTarget(key, expected);
    await this.env.trashItem(this.abs(key));
    if (tree) this.store.deleteTree(key);
    else this.store.delete(key);
    this.result.trashedLocal++;
  }

  /** Both sides changed: the local file keeps its content under a conflicted name, the server's wins the name. */
  private async doConflict(key: string, local: LocalItem, remote: RemoteNode): Promise<void> {
    this.requireParent(key);
    await this.assertInsideRoot(this.abs(key));
    if (local.kind === "file") await this.assertTarget(key, local);
    const abs = this.abs(key);
    const dir = dirname(abs);
    const taken = new Set(await readdir(dir));
    const copyName = uniqueName(
      conflictedName(baseOf(key), this.env.deviceName, new Date(this.env.now())),
      taken,
    );
    const copyKey = joinPath(parentOf(key), copyName.normalize("NFC"));
    await rename(abs, join(dir, copyName));
    this.store.deleteTree(key);
    this.result.conflicts++;
    this.env.activity({ type: "conflict", path: key, to: copyKey, phase: "done" });

    if (remote.kind === "folder") await this.doMkdirLocal(key, remote);
    else await this.doDownload(key, remote, undefined);

    if (local.kind === "file") {
      this.scan.actual.set(copyKey, joinPath(parentOf(this.scan.actual.get(key) ?? key), copyName));
      this.scan.actual.delete(key);
      await this.doUpload(copyKey, undefined);
    } else {
      this.rerun = true;
    }
  }

  private async adoptRemoteFolder(dir: string, parentId: string): Promise<string> {
    const name = baseOf(dir);
    let node: FileNode | undefined;
    try {
      node = await this.env.api.createFolder(parentId, name);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "name_conflict")) throw err;
      node = (await this.env.api.listFolder(parentId)).find(
        (child) => child.kind === "folder" && child.name.normalize("NFC") === name,
      );
      if (!node) throw err;
    }
    this.store.set(dir, {
      fileId: node.id,
      kind: "folder",
      remoteVersionId: null,
      size: 0,
      mtimeMs: 0,
      sha256: null,
    });
    this.tree.nodes.set(node.id, {
      id: node.id,
      parentId,
      name,
      kind: "folder",
      versionId: null,
      size: 0,
    });
    return node.id;
  }

  private ensureRemoteDir(dir: string): Promise<string> {
    if (dir === "") return Promise.resolve(this.rootId);
    const known = this.entries.get(dir);
    if (known) {
      if (known.kind !== "folder") {
        return Promise.reject(Object.assign(new Error("not_a_folder"), { code: "not_a_folder" }));
      }
      return Promise.resolve(known.fileId);
    }
    const pending = this.ensuring.get(dir);
    if (pending) return pending;
    const created = (async () => {
      const parentId = await this.ensureRemoteDir(parentOf(dir));
      const id = await this.adoptRemoteFolder(dir, parentId);
      return id;
    })().finally(() => {
      this.ensuring.delete(dir);
    });
    this.ensuring.set(dir, created);
    return created;
  }
}
