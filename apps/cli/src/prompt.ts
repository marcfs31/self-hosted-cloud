import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { usageError } from "./errors.js";
import type { Io } from "./io.js";

async function readStdin(io: Io): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of io.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function ask(io: Io, label: string, echo: boolean): Promise<string> {
  io.stderr.write(label);
  const silent = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const rl = createInterface({
    input: io.stdin,
    output: echo ? (io.stderr as NodeJS.WritableStream) : silent,
    terminal: true,
  });
  return new Promise((resolve, reject) => {
    let answered = false;
    rl.once("close", () => {
      if (!answered) reject(usageError("Input ended before an answer was given."));
    });
    rl.question("", (answer) => {
      answered = true;
      rl.close();
      if (!echo) io.stderr.write("\n");
      resolve(answer.trim());
    });
  });
}

/**
 * A secret from the person: typed without echo when stdin is a terminal, otherwise the first
 * line of stdin. It is never written to stdout or stderr.
 */
export async function readSecret(io: Io, label: string): Promise<string> {
  const value =
    io.stdin.isTTY === true
      ? await ask(io, label, false)
      : ((await readStdin(io)).split(/\r?\n/, 1)[0] ?? "").trim();
  if (value === "") throw usageError("No value was given.");
  return value;
}

/** A visible answer; only possible on a terminal. */
export async function readLine(io: Io, label: string): Promise<string> {
  if (io.stdin.isTTY !== true) throw usageError(`${label.replace(/:\s*$/, "")} is required.`);
  const value = await ask(io, label, true);
  if (value === "") throw usageError("No value was given.");
  return value;
}
