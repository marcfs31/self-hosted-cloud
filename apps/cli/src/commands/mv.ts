import { fileNode, type UpdateFileRequest } from "@cloud/shared";
import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { conflictError, usageError } from "../errors.js";
import { formatPath, printJson } from "../format.js";
import { listFolder, parseRemotePath, resolveFolder, resolveNode } from "../paths.js";
import { openSession } from "../session.js";

export const mv: Command = {
  name: "mv",
  summary: "Move or rename a remote item",
  help: `Usage: cloud mv <src> <dest-folder-or-new-name> [--json]

When <dest> is an existing folder, <src> moves into it and keeps its name. Otherwise the parent
of <dest> must be an existing folder, and <src> moves there under the last name in <dest>.
Moving onto an existing file is refused.

Options:
  --json  Print machine-readable JSON on stdout: { from, to, node }`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, JSON_OPTION);
    const [source, dest, ...extra] = positionals;
    if (source === undefined || dest === undefined || extra.length > 0) {
      throw usageError("mv needs a source and a destination.");
    }
    const sourceSegments = parseRemotePath(source);
    if (sourceSegments.length === 0) throw usageError("The root cannot be moved.");
    const destSegments = parseRemotePath(dest);
    const { client } = await openSession(io);
    const node = await resolveNode(client, sourceSegments);

    const parent = await resolveFolder(client, destSegments.slice(0, -1));
    const lastName = destSegments.at(-1);
    const siblings = await listFolder(client, parent.id);
    const existing =
      lastName === undefined ? parent : siblings.children.find((c) => c.name === lastName);

    let targetParentId = parent.id;
    let newName = lastName ?? node.name;
    let toSegments = destSegments;
    if (existing?.id === node.id) {
      throw usageError(`${formatPath(sourceSegments)} is already there.`);
    }
    if (existing !== undefined) {
      if (existing.kind !== "folder") {
        throw conflictError(`${formatPath(destSegments)} already exists.`);
      }
      targetParentId = existing.id;
      newName = node.name;
      toSegments = [...destSegments, node.name];
    }

    const patch: UpdateFileRequest = {};
    if (targetParentId !== node.parentId) patch.parentId = targetParentId;
    if (newName !== node.name) patch.name = newName;
    const moved = await client.json(
      "PATCH",
      `/api/files/${encodeURIComponent(node.id)}`,
      fileNode,
      patch,
    );
    if (values.json === true) {
      printJson(io, { from: formatPath(sourceSegments), to: formatPath(toSegments), node: moved });
    } else {
      io.stdout.write(`Moved ${formatPath(sourceSegments)} to ${formatPath(toSegments)}\n`);
    }
  },
};
