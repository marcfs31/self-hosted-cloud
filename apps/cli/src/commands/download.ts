import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, lstat, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { CliError, EXIT, conflictError, usageError } from "../errors.js";
import { formatBytes, formatPath, printJson } from "../format.js";
import { parseRemotePath, resolveNode } from "../paths.js";
import { openSession } from "../session.js";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

export const download: Command = {
  name: "download",
  summary: "Download a remote file",
  help: `Usage: cloud download <remote-path> [local-path] [--force] [--json]

Download a file. It is written to a temporary file next to its destination and renamed when
complete, so an interrupted download never leaves a half file under the final name. The local
path defaults to the file's name in the current directory; when it is an existing directory the
file goes inside it. An existing local file is never overwritten unless --force is given.

Folders cannot be downloaded directly: create a share link with 'cloud share <folder>' and
open its zip download.

Options:
  --force  Overwrite an existing local file
  --json   Print machine-readable JSON on stdout: { remote, local, size }`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, {
      ...JSON_OPTION,
      force: { type: "boolean" },
    });
    const [remote, local, ...extra] = positionals;
    if (remote === undefined || extra.length > 0) {
      throw usageError("download needs a remote path and optionally a local path.");
    }
    const segments = parseRemotePath(remote);
    const { client } = await openSession(io);
    const node = await resolveNode(client, segments);
    if (node.kind === "folder") {
      throw usageError(
        `${formatPath(segments)} is a folder. Create a share link with 'cloud share ${formatPath(segments)}' and download it as a zip.`,
      );
    }

    let destination = resolve(io.cwd, local ?? node.name);
    if (await isDirectory(destination)) {
      if (local === undefined) throw conflictError(`${destination} is a directory.`);
      destination = join(destination, basename(node.name));
    }
    const force = values.force === true;
    if (!force && (await exists(destination))) {
      throw conflictError(`${destination} already exists. Use --force to overwrite it.`);
    }

    const res = await client.stream(`/api/files/${encodeURIComponent(node.id)}/content?download=1`);
    const temp = join(
      dirname(destination),
      `.${basename(destination)}.${randomBytes(6).toString("hex")}.part`,
    );
    const showProgress = io.stderr.isTTY === true;
    let written = 0;
    try {
      const body = res.body;
      if (body !== null) {
        await pipeline(
          Readable.fromWeb(body as WebReadableStream<Uint8Array>),
          async function* (source: AsyncIterable<Buffer>) {
            for await (const chunk of source) {
              written += chunk.length;
              if (showProgress) {
                io.stderr.write(
                  `\r${node.name}: ${formatBytes(written)} of ${formatBytes(node.size)}`,
                );
              }
              yield chunk;
            }
          },
          createWriteStream(temp, { flags: "wx" }),
        );
      } else {
        await pipeline(Readable.from([]), createWriteStream(temp, { flags: "wx" }));
      }
      if (showProgress) io.stderr.write("\r\u001B[K");
      if (written !== node.size) {
        throw new CliError(
          `The download was incomplete (${written} of ${node.size} bytes).`,
          EXIT.other,
          "incomplete",
        );
      }
      if (force) {
        await rename(temp, destination);
      } else {
        try {
          // link() refuses to replace anything, so a file created meanwhile is never clobbered.
          await link(temp, destination);
          await rm(temp);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") {
            throw conflictError(`${destination} already exists. Use --force to overwrite it.`);
          }
          await rename(temp, destination);
        }
      }
    } finally {
      await rm(temp, { force: true });
    }

    if (values.json === true) {
      printJson(io, { remote: formatPath(segments), local: destination, size: written });
    } else {
      io.stdout.write(
        `Downloaded ${formatPath(segments)} to ${destination} (${formatBytes(written)})\n`,
      );
    }
  },
};
