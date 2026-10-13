import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { usageError } from "./errors.js";
import type { Io } from "./io.js";

export interface Command {
  name: string;
  summary: string;
  /** Full text printed by `cloud <name> --help`. */
  help: string;
  run(argv: readonly string[], io: Io): Promise<void>;
}

/** Every command takes --json. */
export const JSON_OPTION = { json: { type: "boolean" } } as const;

/** Strict option parsing; a bad option becomes a usage error (exit 1) instead of a stack trace. */
export function parseCommandArgs<O extends ParseArgsOptionsConfig>(
  argv: readonly string[],
  options: O,
) {
  try {
    return parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (err) {
    throw usageError(err instanceof Error ? err.message : "Invalid arguments.");
  }
}
