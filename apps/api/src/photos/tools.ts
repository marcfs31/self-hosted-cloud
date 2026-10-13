import { spawn } from "node:child_process";

/**
 * External media tools. A path is looked up on PATH when it has no directory; `null` means the
 * tool is known to be absent (tests, or a deployment that opted out).
 */
export interface MediaTools {
  ffmpeg: string | null;
  ffprobe: string | null;
}

export const DEFAULT_MEDIA_TOOLS: MediaTools = { ffmpeg: "ffmpeg", ffprobe: "ffprobe" };

export type ToolFailure = "unavailable" | "failed" | "timeout" | "too_large";

export class ToolError extends Error {
  constructor(readonly reason: ToolFailure) {
    super(reason);
    this.name = "ToolError";
  }
}

/**
 * Run `command` with an argument array (never a shell) and collect stdout. The child is killed on
 * timeout or when stdout grows past `maxBytes`. A missing binary is "unavailable", any other
 * failure (non-zero exit, killed) is "failed".
 */
export function runTool(
  command: string | null,
  args: string[],
  opts: { timeoutMs: number; maxBytes: number },
): Promise<Buffer> {
  if (command === null) return Promise.reject(new ToolError("unavailable"));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: ToolFailure | null = null;
    let settled = false;

    const finish = (err: ToolError | null, value?: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value ?? Buffer.alloc(0));
    };
    const abort = (reason: ToolFailure): void => {
      failure ??= reason;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      abort("timeout");
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > opts.maxBytes) {
        abort("too_large");
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(
        new ToolError(err.code === "ENOENT" || err.code === "EACCES" ? "unavailable" : "failed"),
      );
    });
    child.on("close", (code) => {
      if (failure) finish(new ToolError(failure));
      else if (code === 0) finish(null, Buffer.concat(chunks));
      else finish(new ToolError("failed"));
    });
  });
}
