import { readFileSync } from "node:fs";
import type { Command } from "./args.js";
import { download } from "./commands/download.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { ls } from "./commands/ls.js";
import { mkdir } from "./commands/mkdir.js";
import { mv } from "./commands/mv.js";
import { rm } from "./commands/rm.js";
import { search } from "./commands/search.js";
import { share } from "./commands/share.js";
import { upload } from "./commands/upload.js";
import { whoami } from "./commands/whoami.js";
import { CliError, EXIT, usageError } from "./errors.js";
import type { Io } from "./io.js";

const COMMANDS: readonly Command[] = [
  login,
  logout,
  whoami,
  ls,
  upload,
  download,
  mkdir,
  mv,
  rm,
  search,
  share,
];

export function version(): string {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    version: string;
  };
  return manifest.version;
}

function topHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  const lines = COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`);
  return `cloud ${version()} - command-line tool for your self-hosted cloud

Usage: cloud <command> [options]

Commands:
${lines.join("\n")}

Run 'cloud <command> --help' for the options of a command. Every command accepts --json for
machine-readable output on stdout. Errors go to stderr.

Exit codes: 0 success, 1 usage error, 2 not signed in or not allowed, 3 not found,
4 conflict (name taken), 5 not enough storage, 10 anything else.

Remote paths are '/'-separated names from the root of your cloud, like /Documents/report.pdf.
Sign in with an app password from Settings > App passwords: cloud login --server <url>
`;
}

function wantsHelp(args: readonly string[]): boolean {
  const end = args.indexOf("--");
  return (end === -1 ? args : args.slice(0, end)).some((a) => a === "--help" || a === "-h");
}

async function dispatch(argv: readonly string[], io: Io): Promise<void> {
  const [first, ...rest] = argv;
  if (first === undefined) {
    io.stderr.write(topHelp());
    throw usageError("No command given.");
  }
  if (first === "--help" || first === "-h") {
    io.stdout.write(topHelp());
    return;
  }
  if (first === "--version" || first === "-v") {
    io.stdout.write(`${version()}\n`);
    return;
  }
  if (first === "help") {
    const target = COMMANDS.find((c) => c.name === rest[0]);
    if (rest[0] !== undefined && !target) throw usageError(`Unknown command: ${rest[0]}`);
    io.stdout.write(target ? `${target.help}\n` : topHelp());
    return;
  }
  const command = COMMANDS.find((c) => c.name === first);
  if (!command) throw usageError(`Unknown command: ${first}. Run 'cloud --help' for the list.`);
  if (wantsHelp(rest)) {
    io.stdout.write(`${command.help}\n`);
    return;
  }
  try {
    await command.run(rest, io);
  } catch (err) {
    if (err instanceof CliError && err.code === "usage") {
      throw new CliError(
        `${err.message}\nRun 'cloud ${command.name} --help' for usage.`,
        err.exitCode,
        err.code,
      );
    }
    throw err;
  }
}

/** Run one invocation. Resolves with the process exit code; never throws. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  try {
    await dispatch(argv, io);
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      io.stderr.write(`cloud: ${err.message}\n`);
      return err.exitCode;
    }
    const message = err instanceof Error ? err.message : "unknown error";
    io.stderr.write(`cloud: unexpected error: ${message}\n`);
    return EXIT.other;
  }
}
