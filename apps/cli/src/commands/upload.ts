import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { FileNode, FolderListing } from "@cloud/shared";
import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import type { ApiClient } from "../client.js";
import { conflictError, notFoundError, usageError } from "../errors.js";
import { formatBytes, formatPath, printJson } from "../format.js";
import type { Io } from "../io.js";
import { childFolder, listFolder, parseRemotePath, resolveFolder } from "../paths.js";
import { openSession } from "../session.js";
import { tusUpload } from "../tus.js";

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

type Mode = "keep-both" | "replace";

interface Uploaded {
  path: string;
  id: string;
  size: number;
  replaced: boolean;
}

interface Context {
  io: Io;
  client: ApiClient;
  mode: Mode;
  json: boolean;
  done: Uploaded[];
}

interface PendingFile {
  local: string;
  name: string;
  size: number;
}

async function statLocal(path: string): Promise<Awaited<ReturnType<typeof stat>>> {
  try {
    return await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw notFoundError(`No such local file or folder: ${path}`);
    }
    throw err;
  }
}

function progressReporter(
  ctx: Context,
  name: string,
): ((sent: number, total: number) => void) | undefined {
  if (ctx.io.stderr.isTTY !== true) return undefined;
  let last = -1;
  return (sent, total) => {
    const percent = total === 0 ? 100 : Math.floor((sent / total) * 100);
    if (percent === last) return;
    last = percent;
    ctx.io.stderr.write(`\r${name}: ${percent}% (${formatBytes(sent)} of ${formatBytes(total)})`);
    if (sent >= total) ctx.io.stderr.write("\r\u001B[K");
  };
}

/** Upload files into one folder, then look the folder up once to report the names the server chose. */
async function uploadFiles(
  ctx: Context,
  folder: FileNode,
  folderSegments: readonly string[],
  files: readonly PendingFile[],
): Promise<void> {
  if (files.length === 0) return;
  const existing =
    ctx.mode === "replace"
      ? new Map((await listFolder(ctx.client, folder.id)).children.map((c) => [c.name, c]))
      : null;
  const sent: { id: string; name: string; size: number; replaced: boolean }[] = [];
  let failure: Error | undefined;
  try {
    for (const file of files) {
      const target = existing?.get(file.name.normalize("NFC"));
      if (target?.kind === "folder") {
        throw conflictError(`${formatPath([...folderSegments, file.name])} is a folder.`);
      }
      const metadata: Record<string, string> = { filename: file.name, parentId: folder.id };
      if (target !== undefined) metadata.replaceId = target.id;
      const progress = progressReporter(ctx, file.name);
      const id = await tusUpload(
        ctx.client,
        { path: file.local, size: file.size, metadata },
        {
          chunkSize: ctx.io.chunkSize ?? DEFAULT_CHUNK_SIZE,
          ...(progress && { onProgress: progress }),
        },
      );
      sent.push({ id, name: file.name, size: file.size, replaced: target !== undefined });
    }
  } catch (err) {
    failure = err instanceof Error ? err : new Error("The upload failed.");
  }

  let names = new Map<string, string>();
  if (sent.length > 0) {
    try {
      const listing = await listFolder(ctx.client, folder.id);
      names = new Map(listing.children.map((c) => [c.id, c.name]));
    } catch {
      // report the requested names instead
    }
  }
  for (const item of sent) {
    const path = formatPath([...folderSegments, names.get(item.id) ?? item.name]);
    ctx.done.push({ path, id: item.id, size: item.size, replaced: item.replaced });
    if (!ctx.json) {
      const note = item.replaced ? " (new version)" : "";
      ctx.io.stdout.write(`Uploaded ${path} (${formatBytes(item.size)})${note}\n`);
    }
  }
  if (failure !== undefined) throw failure;
}

async function uploadDirectory(
  ctx: Context,
  local: string,
  folder: FileNode,
  folderSegments: readonly string[],
): Promise<void> {
  const entries = (await readdir(local, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const files: PendingFile[] = [];
  const directories: string[] = [];
  for (const entry of entries) {
    const path = join(local, entry.name);
    if (entry.isFile())
      files.push({ local: path, name: entry.name, size: (await stat(path)).size });
    else if (entry.isDirectory()) directories.push(entry.name);
    else ctx.io.stderr.write(`Skipping ${path}: only regular files and folders are uploaded\n`);
  }
  await uploadFiles(ctx, folder, folderSegments, files);
  if (directories.length === 0) return;
  const listing: FolderListing = await listFolder(ctx.client, folder.id);
  for (const name of directories) {
    const { node } = await childFolder(ctx.client, listing, name.normalize("NFC"));
    await uploadDirectory(ctx, join(local, name), node, [...folderSegments, node.name]);
  }
}

export const upload: Command = {
  name: "upload",
  summary: "Upload local files or folders",
  help: `Usage: cloud upload <local-file>... [--to remote-folder] [--replace | --keep-both] [--recursive] [--json]

Upload files with the resumable tus protocol (large files are sent in chunks and continue from
where the server has them after a network error). Progress is shown on a terminal.

When a file with the same name already exists in the destination folder:
  --keep-both  (default) the server keeps both and names the new one "name (1).ext"
  --replace    the upload becomes a new version of the existing file

Options:
  --to FOLDER      Remote destination folder (default: the root, '/')
  --replace        Replace existing files (they keep their version history)
  --keep-both      Keep both files when names collide (the default)
  -r, --recursive  Upload a local folder with everything inside it, creating remote folders
                   as needed (existing ones are reused)
  --json           Print machine-readable JSON on stdout: { uploaded: [{ path, id, size, replaced }] }`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, {
      ...JSON_OPTION,
      to: { type: "string" },
      replace: { type: "boolean" },
      "keep-both": { type: "boolean" },
      recursive: { type: "boolean", short: "r" },
    });
    if (positionals.length === 0) throw usageError("upload needs at least one local file.");
    if (values.replace === true && values["keep-both"] === true) {
      throw usageError("Use either --replace or --keep-both, not both.");
    }
    const destinationSegments = parseRemotePath(values.to ?? "/");

    const locals: { path: string; directory: boolean }[] = [];
    for (const arg of positionals) {
      const path = resolve(io.cwd, arg);
      const info = await statLocal(path);
      if (info.isDirectory()) {
        if (values.recursive !== true) {
          throw usageError(`${arg} is a folder. Use --recursive to upload folders.`);
        }
        if (basename(path) === "")
          throw usageError("Upload a named folder, not the filesystem root.");
        locals.push({ path, directory: true });
      } else if (info.isFile()) {
        locals.push({ path, directory: false });
      } else {
        throw usageError(`${arg} is not a regular file or folder.`);
      }
    }

    const { client } = await openSession(io);
    const destination = await resolveFolder(client, destinationSegments);
    const ctx: Context = {
      io,
      client,
      mode: values.replace === true ? "replace" : "keep-both",
      json: values.json === true,
      done: [],
    };

    const files: PendingFile[] = [];
    for (const local of locals.filter((l) => !l.directory)) {
      files.push({
        local: local.path,
        name: basename(local.path),
        size: (await stat(local.path)).size,
      });
    }
    await uploadFiles(ctx, destination, destinationSegments, files);

    const directories = locals.filter((l) => l.directory);
    if (directories.length > 0) {
      const listing = await listFolder(client, destination.id);
      for (const dir of directories) {
        const { node } = await childFolder(client, listing, basename(dir.path).normalize("NFC"));
        await uploadDirectory(ctx, dir.path, node, [...destinationSegments, node.name]);
      }
    }

    if (ctx.json) printJson(io, { uploaded: ctx.done });
    else if (ctx.done.length === 0) io.stdout.write("Nothing to upload.\n");
  },
};
