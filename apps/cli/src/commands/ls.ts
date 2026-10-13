import type { FileNode } from "@cloud/shared";
import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { usageError } from "../errors.js";
import { formatBytes, formatPath, formatTime, printJson, table } from "../format.js";
import { listFolder, parseRemotePath, resolveNode } from "../paths.js";
import { openSession } from "../session.js";

export function nodeRow(node: FileNode): string[] {
  const folder = node.kind === "folder";
  return [
    node.kind,
    folder ? "-" : formatBytes(node.size),
    formatTime(node.updatedAt),
    folder ? `${node.name}/` : node.name,
  ];
}

export const ls: Command = {
  name: "ls",
  summary: "List a remote folder",
  help: `Usage: cloud ls [remote-path] [--json]

List a folder (the root, '/', by default) or describe a single file. Remote paths are
'/'-separated names starting at the root of your cloud.

Columns: kind, size (binary units), modified, name.

Options:
  --json  Print machine-readable JSON on stdout: { path, items: [...] }`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, JSON_OPTION);
    if (positionals.length > 1) throw usageError("ls takes at most one path.");
    const segments = parseRemotePath(positionals[0] ?? "/");
    const { client } = await openSession(io);
    const node = await resolveNode(client, segments);
    const items = node.kind === "folder" ? (await listFolder(client, node.id)).children : [node];
    if (values.json === true) {
      printJson(io, { path: formatPath(segments), items });
      return;
    }
    if (items.length > 0) {
      io.stdout.write(`${table(items.map(nodeRow), ["left", "right", "left", "left"])}\n`);
    }
  },
};
