import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { cp, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function sha256File(abs: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(abs)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** temp file → fsync → rename → fsync of the directory (best effort on platforms that refuse it). */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (err) {
    await handle.close();
    await rm(tmp, { force: true });
    throw err;
  }
  await handle.close();
  await rename(tmp, file);
  try {
    const dir = await open(dirname(file), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } catch {
    // directory fsync is not supported everywhere; the rename above already happened
  }
}

/**
 * The default "move to trash": a folder inside the app data dir. The shell swaps in
 * Electron's shell.trashItem. Nothing is ever hard-deleted.
 */
export function trashIntoFolder(
  trashDir: string,
  now: () => number,
): (abs: string) => Promise<void> {
  let counter = 0;
  return async (abs) => {
    await mkdir(trashDir, { recursive: true });
    const stamp = new Date(now()).toISOString().replaceAll(":", "-");
    const target = join(trashDir, `${stamp}-${String(counter++)}-${basename(abs)}`);
    try {
      await rename(abs, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      await cp(abs, target, { recursive: true, errorOnExist: true, force: false });
      await rm(abs, { recursive: true });
    }
  };
}
