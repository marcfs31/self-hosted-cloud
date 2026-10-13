import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { deleteConfig } from "../config.js";
import { usageError } from "../errors.js";
import { printJson } from "../format.js";

export const logout: Command = {
  name: "logout",
  summary: "Forget the stored app password",
  help: `Usage: cloud logout [--json]

Delete the stored login from this computer. The app password itself stays valid on the server
until you revoke it in Settings > App passwords.

Options:
  --json  Print machine-readable JSON on stdout`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, JSON_OPTION);
    if (positionals.length > 0) throw usageError("logout takes no arguments.");
    const removed = await deleteConfig(io);
    if (values.json === true) {
      printJson(io, { loggedOut: removed });
      return;
    }
    io.stdout.write(
      removed
        ? "Logged out. The app password is still valid on the server; revoke it in Settings > App passwords.\n"
        : "You were not logged in.\n",
    );
  },
};
