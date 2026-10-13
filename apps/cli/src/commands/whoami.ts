import { meResponse, usageResponse } from "@cloud/shared";
import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { usageError } from "../errors.js";
import { formatBytes, printJson } from "../format.js";
import { openSession } from "../session.js";

export const whoami: Command = {
  name: "whoami",
  summary: "Show the signed-in account",
  help: `Usage: cloud whoami [--json]

Ask the server who the stored app password belongs to, and how much storage is used.

Options:
  --json  Print machine-readable JSON on stdout`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, JSON_OPTION);
    if (positionals.length > 0) throw usageError("whoami takes no arguments.");
    const { client, config } = await openSession(io);
    const { user } = await client.json("GET", "/api/auth/me", meResponse);
    const usage = await client.json("GET", "/api/usage", usageResponse);
    if (values.json === true) {
      printJson(io, {
        server: config.server,
        email: user.email,
        role: user.role,
        usedBytes: usage.usedBytes,
        quotaBytes: usage.quotaBytes,
      });
      return;
    }
    io.stdout.write(
      `${user.email} (${user.role}) on ${config.server}\n` +
        `Storage: ${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)} used\n`,
    );
  },
};
