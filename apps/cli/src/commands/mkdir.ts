import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { conflictError, usageError } from "../errors.js";
import { formatPath, printJson } from "../format.js";
import {
  childFolder,
  createFolder,
  listFolder,
  listRoot,
  parseRemotePath,
  resolveFolder,
} from "../paths.js";
import { openSession } from "../session.js";

export const mkdir: Command = {
  name: "mkdir",
  summary: "Create a remote folder",
  help: `Usage: cloud mkdir <remote-path> [-p] [--json]

Create a folder. The parent folder must exist unless -p is given.

Options:
  -p, --parents  Create missing parent folders; do nothing when the folder already exists
  --json         Print machine-readable JSON on stdout: { path, folder, created }`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, {
      ...JSON_OPTION,
      parents: { type: "boolean", short: "p" },
    });
    const [target, ...extra] = positionals;
    if (target === undefined || extra.length > 0) {
      throw usageError("mkdir needs exactly one remote path.");
    }
    const segments = parseRemotePath(target);
    const name = segments.at(-1);
    if (name === undefined) throw usageError("Give a folder name; the root already exists.");
    const { client } = await openSession(io);

    let folder;
    let created: boolean;
    if (values.parents === true) {
      let listing = await listRoot(client);
      let step = { node: listing.folder, created: false };
      for (const segment of segments) {
        step = await childFolder(client, listing, segment);
        listing = step.created
          ? { folder: step.node, breadcrumbs: [], children: [] }
          : await listFolder(client, step.node.id);
      }
      folder = step.node;
      created = step.created;
    } else {
      const parent = await resolveFolder(client, segments.slice(0, -1));
      const siblings = await listFolder(client, parent.id);
      if (siblings.children.some((child) => child.name === name)) {
        throw conflictError(`${formatPath(segments)} already exists.`);
      }
      folder = await createFolder(client, parent.id, name);
      created = true;
    }
    if (values.json === true) {
      printJson(io, { path: formatPath(segments), folder, created });
    } else {
      io.stdout.write(`${created ? "Created" : "Already exists:"} ${formatPath(segments)}\n`);
    }
  },
};
