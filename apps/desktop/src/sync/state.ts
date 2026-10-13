import { readFile, rename } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileKind } from "@cloud/shared";
import { writeFileAtomic } from "./fsops.js";
import { isUnder, parentOf, replacePrefix } from "./paths.js";

/** What both sides looked like the last time this path was in sync. */
export interface SyncEntry {
  fileId: string;
  kind: FileKind;
  /** Null for folders. */
  remoteVersionId: string | null;
  size: number;
  /** -1 = "recently written, hash again next time" (racy-clean guard). */
  mtimeMs: number;
  /** Null for folders. */
  sha256: string | null;
}

interface StateFile {
  version: 1;
  cursor: string | null;
  rootId: string | null;
  entries: Record<string, SyncEntry>;
}

function isEntry(value: unknown): value is SyncEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  const folder = e["kind"] === "folder";
  return (
    typeof e["fileId"] === "string" &&
    (folder || e["kind"] === "file") &&
    (e["remoteVersionId"] === null || typeof e["remoteVersionId"] === "string") &&
    typeof e["size"] === "number" &&
    typeof e["mtimeMs"] === "number" &&
    (e["sha256"] === null || typeof e["sha256"] === "string") &&
    (folder || (typeof e["remoteVersionId"] === "string" && typeof e["sha256"] === "string"))
  );
}

export type LoadOutcome = "missing" | "loaded" | "corrupt";

/**
 * The persistent sync state: the change-feed cursor, the root's remote ID and one entry per
 * synced path. Written atomically (temp + fsync + rename) so a crash leaves the old or the new
 * file, never half of one. A missing or unreadable file means "first sync": the engine then
 * only ever adds, because deletions are derived from entries.
 */
export class StateStore {
  cursor: string | null = null;
  rootId: string | null = null;
  readonly entries = new Map<string, SyncEntry>();
  private dirty = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(readonly file: string) {}

  async load(): Promise<LoadOutcome> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      await this.quarantine();
      return "corrupt";
    }
    const raw = parsed as Partial<StateFile> | null | undefined;
    if (
      typeof raw !== "object" ||
      raw === null ||
      raw.version !== 1 ||
      typeof raw.entries !== "object"
    ) {
      await this.quarantine();
      return "corrupt";
    }
    this.cursor = typeof raw.cursor === "string" ? raw.cursor : null;
    this.rootId = typeof raw.rootId === "string" ? raw.rootId : null;
    this.entries.clear();
    for (const [path, entry] of Object.entries(raw.entries)) {
      if (isEntry(entry)) this.entries.set(path, entry);
    }
    this.dropOrphans();
    return "loaded";
  }

  private async quarantine(): Promise<void> {
    this.cursor = null;
    this.rootId = null;
    this.entries.clear();
    await rename(this.file, `${this.file}.corrupt-${String(Date.now())}`);
  }

  /** An entry whose parent folder is not an entry cannot be placed in the remote tree. */
  private dropOrphans(): void {
    for (const path of [...this.entries.keys()].sort()) {
      const parent = parentOf(path);
      if (parent === "") continue;
      if (this.entries.get(parent)?.kind !== "folder") this.entries.delete(path);
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  set(path: string, entry: SyncEntry): void {
    this.entries.set(path, entry);
    this.dirty = true;
  }

  delete(path: string): void {
    if (this.entries.delete(path)) this.dirty = true;
  }

  deleteTree(path: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key === path || isUnder(key, path)) this.entries.delete(key);
    }
    this.dirty = true;
  }

  rekey(from: string, to: string): void {
    const moved: [string, SyncEntry][] = [];
    for (const [key, entry] of this.entries) {
      if (key === from || isUnder(key, from)) moved.push([key, entry]);
    }
    for (const [key] of moved) this.entries.delete(key);
    for (const [key, entry] of moved) this.entries.set(replacePrefix(key, from, to), entry);
    this.dirty = true;
  }

  setCursor(cursor: string): void {
    if (this.cursor !== cursor) {
      this.cursor = cursor;
      this.dirty = true;
    }
  }

  setRootId(rootId: string): void {
    if (this.rootId !== rootId) {
      this.rootId = rootId;
      this.dirty = true;
    }
  }

  /** Writes are serialised and coalesced: a save issued while one is running waits and then no-ops. */
  save(): Promise<void> {
    const run = this.chain.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      const body: StateFile = {
        version: 1,
        cursor: this.cursor,
        rootId: this.rootId,
        entries: Object.fromEntries(this.entries),
      };
      try {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFileAtomic(this.file, JSON.stringify(body));
      } catch (err) {
        this.dirty = true;
        throw err;
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
