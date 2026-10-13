/**
 * Consistent online copy of the live SQLite database.
 *
 *   node dist/backup-db.js <dest>      DATA_DIR must be set; the source is <DATA_DIR>/db/cloud.sqlite
 *
 * Uses SQLite's online backup API, so it is safe while the API is serving traffic (WAL): the
 * live files are only ever read. The copy is written to <dest>.tmp, switched to a single
 * self-contained file (journal_mode=DELETE, so no -wal/-shm travel with it), verified with
 * PRAGMA integrity_check, fsynced and renamed over <dest>. A reader sees the old complete
 * file or the new complete file, never a partial one.
 *
 * Exit codes: 0 success, 1 failure (message on stderr), 2 usage.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

/** Pages copied per step: large, so a concurrent write is unlikely to restart the copy. */
const PAGES_PER_STEP = 4096;

function fsyncPath(path: string, flags: "r" | "r+"): void {
  const fd = openSync(path, flags);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function removeIfPresent(path: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(path + suffix, { force: true });
}

export async function backupDatabase(source: string, dest: string): Promise<void> {
  if (!existsSync(source)) throw new Error(`database not found: ${source}`);
  const target = resolve(dest);
  if (target === resolve(source)) throw new Error("destination is the live database");
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  removeIfPresent(tmp);

  try {
    const live = new Database(source, { readonly: true, fileMustExist: true });
    try {
      await live.backup(tmp, { progress: () => PAGES_PER_STEP });
    } finally {
      live.close();
    }

    const copy = new Database(tmp, { fileMustExist: true });
    try {
      copy.pragma("journal_mode = DELETE");
      const verdict = copy.pragma("integrity_check", { simple: true });
      if (verdict !== "ok")
        throw new Error(`integrity_check on the copy failed: ${String(verdict)}`);
    } finally {
      copy.close();
    }

    fsyncPath(tmp, "r+");
    renameSync(tmp, target);
    fsyncPath(dirname(target), "r");
  } catch (err) {
    removeIfPresent(tmp);
    throw err;
  }
}

export async function runCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  stderr: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): Promise<number> {
  const [dest, ...extra] = argv;
  if (!dest || extra.length > 0) {
    stderr("usage: node dist/backup-db.js <dest>   (DATA_DIR must be set)");
    return 2;
  }
  const dataDir = env.DATA_DIR;
  if (!dataDir) {
    stderr("backup-db: DATA_DIR is not set");
    return 1;
  }
  try {
    await backupDatabase(join(dataDir, "db", "cloud.sqlite"), dest);
    return 0;
  } catch (err) {
    stderr(`backup-db: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli(process.argv.slice(2), process.env);
}
