import type { Change, FileKind } from "@cloud/shared";
import { isIgnoredPath } from "./ignore.js";
import { baseOf, joinPath, parentOf } from "./paths.js";
import type { SyncEntry } from "./state.js";

export interface RemoteNode {
  id: string;
  parentId: string | null;
  name: string;
  kind: FileKind;
  versionId: string | null;
  size: number;
}

/** The server's tree as far as this client knows it: the last synced state plus the change feed. */
export class RemoteTree {
  readonly nodes = new Map<string, RemoteNode>();

  constructor(readonly rootId: string) {}

  /** Start from what was synced; the feed then overrides what changed. */
  static fromEntries(rootId: string, entries: ReadonlyMap<string, SyncEntry>): RemoteTree {
    const tree = new RemoteTree(rootId);
    for (const [path, entry] of entries) {
      const parent = parentOf(path);
      const parentId = parent === "" ? rootId : entries.get(parent)?.fileId;
      if (parentId === undefined) continue;
      tree.nodes.set(entry.fileId, {
        id: entry.fileId,
        parentId,
        name: baseOf(path),
        kind: entry.kind,
        versionId: entry.remoteVersionId,
        size: entry.size,
      });
    }
    return tree;
  }

  apply(changes: readonly Change[]): void {
    for (const change of changes) {
      if (change.type === "upsert") {
        const { node } = change;
        if (node.id === this.rootId) continue;
        this.nodes.set(node.id, {
          id: node.id,
          parentId: node.parentId,
          name: node.name.normalize("NFC"),
          kind: node.kind,
          versionId: node.currentVersionId,
          size: node.size,
        });
      } else {
        this.remove(change.id);
      }
    }
  }

  private remove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.delete(id);
    if (node.kind !== "folder") return;
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const other of this.nodes.values()) {
        if (other.parentId !== null && doomed.has(other.parentId) && !doomed.has(other.id)) {
          doomed.add(other.id);
          grew = true;
        }
      }
    }
    for (const gone of doomed) this.nodes.delete(gone);
  }

  /** "" for the root; null when the parent chain does not reach it. */
  pathOf(id: string): string | null {
    const names: string[] = [];
    let current = id;
    for (let depth = 0; depth < 4096; depth++) {
      if (current === this.rootId) return names.reverse().reduce((p, n) => joinPath(p, n), "");
      const node = this.nodes.get(current);
      if (!node || node.parentId === null) return null;
      names.push(node.name);
      current = node.parentId;
    }
    return null;
  }

  /** path → node for everything that can be synced (no orphans, nothing under an ignored name). */
  index(): Map<string, RemoteNode> {
    const out = new Map<string, RemoteNode>();
    for (const node of this.nodes.values()) {
      const path = this.pathOf(node.id);
      if (path === null || path === "" || isIgnoredPath(path)) continue;
      out.set(path, node);
    }
    return out;
  }
}
