import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileName, type FileKind } from "@cloud/shared";
import { isIgnoredName, TEMP_PREFIX } from "./ignore.js";
import { joinPath } from "./paths.js";

export interface LocalItem {
  kind: FileKind;
  size: number;
  mtimeMs: number;
}

export interface Scan {
  /** NFC key → what is on disk. */
  items: Map<string, LocalItem>;
  /** NFC key → the spelling on disk (they differ only for names stored un-normalised). */
  actual: Map<string, string>;
  /** Items the server would refuse (names that break the fileName rules). */
  rejected: Set<string>;
  /** Folders that could not be read: nothing under them may be concluded from absence. */
  unreadable: Set<string>;
}

const STALE_TEMP_MS = 60 * 60 * 1000;

/** Recursive readdir + lstat. A missing or unreadable root throws; deeper failures are recorded. */
export async function scanLocal(
  root: string,
  options: { skipAbs: readonly string[]; now: number },
): Promise<Scan> {
  const scan: Scan = {
    items: new Map(),
    actual: new Map(),
    rejected: new Set(),
    unreadable: new Set(),
  };
  const skip = new Set(options.skipAbs);

  async function walk(dirRel: string, dirActual: string, isRoot: boolean): Promise<void> {
    let entries;
    try {
      entries = await readdir(join(root, dirActual), { withFileTypes: true });
    } catch (err) {
      if (isRoot) throw err;
      scan.unreadable.add(dirRel);
      return;
    }
    for (const entry of entries) {
      const abs = join(root, dirActual, entry.name);
      if (skip.has(abs)) continue;
      if (isIgnoredName(entry.name)) {
        if (entry.name.startsWith(TEMP_PREFIX) && entry.isFile()) {
          const st = await lstat(abs).catch(() => undefined);
          if (st && options.now - st.mtimeMs > STALE_TEMP_MS) await rm(abs, { force: true });
        }
        continue;
      }
      if (!entry.isFile() && !entry.isDirectory()) continue; // symlinks, sockets, devices
      const parsed = fileName.safeParse(entry.name);
      const name = parsed.success ? parsed.data : entry.name.normalize("NFC");
      const rel = joinPath(dirRel, name);
      const actualRel = joinPath(dirActual, entry.name);
      if (!parsed.success) {
        scan.rejected.add(rel);
        continue;
      }
      let st;
      try {
        st = await lstat(abs);
      } catch {
        continue; // vanished between readdir and lstat
      }
      if (entry.isDirectory()) {
        scan.items.set(rel, { kind: "folder", size: 0, mtimeMs: 0 });
        scan.actual.set(rel, actualRel);
        await walk(rel, actualRel, false);
      } else {
        scan.items.set(rel, { kind: "file", size: st.size, mtimeMs: st.mtimeMs });
        scan.actual.set(rel, actualRel);
      }
    }
  }

  await walk("", "", true);
  return scan;
}
