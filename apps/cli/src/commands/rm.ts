import { TRASH_RETENTION_DAYS } from "@cloud/shared";
import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { usageError } from "../errors.js";
import { formatPath, printJson } from "../format.js";
import { parseRemotePath, resolveNode } from "../paths.js";
import { openSession } from "../session.js";

export const rm: Command = {
  name: "rm",
  summary: "Move remote items to the trash",
  help: `Usage: cloud rm <remote-path>... [--json]

Move files or folders (with everything inside) to the trash. Nothing is deleted for good:
restore them from the Trash in the web app. Trashed items are purged automatically after
${TRASH_RETENTION_DAYS} days.

Options:
  --json  Print machine-readable JSON on stdout: { trashed: [{ path, id }] }`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, JSON_OPTION);
    if (positionals.length === 0) throw usageError("rm needs at least one remote path.");
    const targets = positionals.map((p) => parseRemotePath(p));
    if (targets.some((segments) => segments.length === 0)) {
      throw usageError("The root cannot be removed.");
    }
    const { client } = await openSession(io);
    const trashed: { path: string; id: string }[] = [];
    for (const segments of targets) {
      const node = await resolveNode(client, segments);
      await client.noContent("DELETE", `/api/files/${encodeURIComponent(node.id)}`);
      trashed.push({ path: formatPath(segments), id: node.id });
      if (values.json !== true) {
        io.stdout.write(
          `Moved ${formatPath(segments)} to the trash (kept ${TRASH_RETENTION_DAYS} days; restore it from Trash in the web app)\n`,
        );
      }
    }
    if (values.json === true) printJson(io, { trashed });
  },
};
