import { searchResponse } from "@cloud/shared";
import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { usageError } from "../errors.js";
import { formatBytes, formatPath, formatTime, printJson, table } from "../format.js";
import { openSession } from "../session.js";

export const search: Command = {
  name: "search",
  summary: "Search file and folder names",
  help: `Usage: cloud search <query> [--limit N] [--json]

Find items whose name contains the query (case-insensitive). Exact matches come first.

Options:
  --limit N  Show at most N results, 1 to 100 (default 50)
  --json     Print machine-readable JSON on stdout: { query, results: [{ path, node }] }`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, {
      ...JSON_OPTION,
      limit: { type: "string" },
    });
    const query = positionals.join(" ").trim();
    if (query === "") throw usageError("search needs a query.");
    let limit = 50;
    if (values.limit !== undefined) {
      limit = Number(values.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw usageError("--limit must be a whole number from 1 to 100.");
      }
    }
    const { client } = await openSession(io);
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const { results } = await client.json(
      "GET",
      `/api/search?${params.toString()}`,
      searchResponse,
    );
    const found = results.map(({ node, path }) => ({
      path: formatPath([...path.map((crumb) => crumb.name).filter((n) => n !== ""), node.name]),
      node,
    }));
    if (values.json === true) {
      printJson(io, { query, results: found });
      return;
    }
    if (found.length === 0) {
      io.stdout.write("No matches.\n");
      return;
    }
    const rows = found.map(({ path, node }) => [
      node.kind,
      node.kind === "folder" ? "-" : formatBytes(node.size),
      formatTime(node.updatedAt),
      node.kind === "folder" ? `${path}/` : path,
    ]);
    io.stdout.write(`${table(rows, ["left", "right", "left", "left"])}\n`);
  },
};
