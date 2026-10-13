import type { Readable } from "node:stream";

export interface OutStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export interface InStream extends Readable {
  isTTY?: boolean;
}

/** Everything a command touches in the outside world, injected so tests never use the real one. */
export interface Io {
  stdout: OutStream;
  stderr: OutStream;
  stdin: InStream;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  homeDir: string;
  /** tus chunk size in bytes (default 8 MiB); tests lower it to exercise chunked uploads. */
  chunkSize?: number;
}
