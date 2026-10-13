import { meResponse } from "@cloud/shared";
import { JSON_OPTION, parseCommandArgs, type Command } from "../args.js";
import { ApiClient } from "../client.js";
import { loadConfig, saveConfig } from "../config.js";
import { CliError, EXIT, usageError } from "../errors.js";
import { printJson } from "../format.js";
import { readLine, readSecret } from "../prompt.js";

/** "cloud.example.com" and "https://cloud.example.com/" both become "https://cloud.example.com". */
export function normalizeServer(input: string): string {
  const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw usageError(`Not a valid server address: ${input}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw usageError(`The server address must start with https:// or http://: ${input}`);
  }
  return url.origin;
}

export const login: Command = {
  name: "login",
  summary: "Sign in with an app password",
  help: `Usage: cloud login [--server URL] [--email EMAIL] [--json]

Verify an app password and store it for the other commands.

Create the app password in the web app under Settings > App passwords. It is read from the
CLOUD_TOKEN environment variable, from stdin when stdin is not a terminal, or typed without
echo. It is never printed. The login is stored in $CLOUD_CONFIG_DIR/config.json, else
$XDG_CONFIG_HOME/cloud/config.json, else ~/.config/cloud/config.json (directory 0700, file 0600).

Options:
  --server URL    Address of your cloud (asked for when not stored yet; CLOUD_SERVER also works)
  --email EMAIL   Check that the app password belongs to this account
  --json          Print machine-readable JSON on stdout`,
  async run(argv, io) {
    const { values, positionals } = parseCommandArgs(argv, {
      ...JSON_OPTION,
      server: { type: "string" },
      email: { type: "string" },
    });
    if (positionals.length > 0) throw usageError("login takes no arguments.");

    const existing = await loadConfig(io).catch(() => null);
    const serverInput =
      values.server ??
      io.env.CLOUD_SERVER ??
      existing?.server ??
      (await readLine(io, "Server address (https://...): "));
    const server = normalizeServer(serverInput);

    const fromEnv = io.env.CLOUD_TOKEN;
    const token =
      fromEnv !== undefined && fromEnv !== ""
        ? fromEnv.trim()
        : await readSecret(io, "App password (input is hidden): ");

    const client = new ApiClient(server, token);
    let user;
    try {
      user = (await client.json("GET", "/api/auth/me", meResponse)).user;
    } catch (err) {
      if (err instanceof CliError && err.exitCode === EXIT.auth) {
        throw new CliError(
          "The server did not accept this app password. Create one in Settings > App passwords.",
          EXIT.auth,
          err.code,
        );
      }
      throw err;
    }
    if (values.email !== undefined && values.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new CliError(
        `This app password belongs to ${user.email}, not ${values.email}.`,
        EXIT.auth,
        "wrong_account",
      );
    }

    await saveConfig(io, { server, email: user.email, token });
    if (values.json === true) printJson(io, { server, email: user.email });
    else io.stdout.write(`Logged in as ${user.email} on ${server}\n`);
  },
};
