import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export interface JpegOptions {
  width?: number;
  height?: number;
  /** EXIF "YYYY:MM:DD HH:MM:SS" written as DateTimeOriginal. */
  dateTimeOriginal?: string;
  /** EXIF "+HH:MM" written as OffsetTimeOriginal. */
  offsetTimeOriginal?: string;
  orientation?: number;
  color?: string;
}

/** A solid-colour JPEG with the requested EXIF fields. */
export async function jpeg(opts: JpegOptions = {}): Promise<Buffer> {
  const { width = 40, height = 20, color = "#c33" } = opts;
  let image = sharp({ create: { width, height, channels: 3, background: color } }).jpeg();
  if (opts.dateTimeOriginal !== undefined) {
    image = image.withExif({
      IFD2: {
        DateTimeOriginal: opts.dateTimeOriginal,
        ...(opts.offsetTimeOriginal !== undefined && {
          OffsetTimeOriginal: opts.offsetTimeOriginal,
        }),
      },
    });
  }
  if (opts.orientation !== undefined) image = image.withMetadata({ orientation: opts.orientation });
  return image.toBuffer();
}

export async function png(width = 16, height = 16): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#369" } })
    .png()
    .toBuffer();
}

/** A scratch directory holding fake ffmpeg/ffprobe executables and their call logs. */
export function toolDir(): string {
  return mkdtempSync(join(tmpdir(), "cloud-tools-"));
}

function script(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/**
 * A stand-in for ffmpeg that prints a PNG frame and appends its argument list to `<dir>/ffmpeg.log`.
 * `emptyAtOneSecond` mimics a clip shorter than a second: seeking to 1 s yields no frame.
 * `fail` exits non-zero. `delayMs` keeps the process busy so concurrent requests overlap.
 */
export async function fakeFfmpeg(
  dir: string,
  opts: { emptyAtOneSecond?: boolean; fail?: boolean; delayMs?: number } = {},
): Promise<{ path: string; log: string }> {
  const frame = (await png(64, 36)).toString("base64");
  const log = join(dir, "ffmpeg.log");
  const path = script(
    dir,
    "ffmpeg",
    `const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const seek = args[args.indexOf("-ss") + 1];
setTimeout(() => {
  if (${JSON.stringify(opts.fail ?? false)}) process.exit(1);
  if (!(${JSON.stringify(opts.emptyAtOneSecond ?? false)} && seek === "1")) {
    process.stdout.write(Buffer.from(${JSON.stringify(frame)}, "base64"));
  }
}, ${opts.delayMs ?? 0});`,
  );
  return { path, log };
}

/** A stand-in for ffprobe that prints `output` as its JSON. */
export function fakeFfprobe(dir: string, output: unknown): string {
  return script(dir, "ffprobe", `process.stdout.write(${JSON.stringify(JSON.stringify(output))});`);
}
