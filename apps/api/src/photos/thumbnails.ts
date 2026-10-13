import { randomUUID } from "node:crypto";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import type { ThumbnailSize } from "./kinds.js";
import { blobPath, thumbPath } from "../files/storage.js";
import { createLimiter } from "./limiter.js";
import { ToolError, runTool, type MediaTools } from "./tools.js";

const FFMPEG_TIMEOUT_MS = 20_000;
const FFMPEG_MAX_BYTES = 64 * 1024 * 1024;
/** One frame, in the container's own orientation; -ss before -i seeks without decoding. */
const FRAME_ARGS = ["-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"];

/** What sharp may decode at all; its own default (268 MP) is 1 GB of pixels per job. */
const MAX_INPUT_PIXELS = 100_000_000;
/**
 * Interlaced PNG and progressive JPEG cannot be resized while streaming: libvips holds the
 * whole decoded image (a 3 MB 16-bit PNG took 2.5 GB). Above this raw size, no thumbnail.
 */
const MAX_WHOLE_IMAGE_BYTES = 256 * 1024 * 1024;

/** The thumbnail cannot be made: not decodable, no ffmpeg, timed out. The route answers 404. */
export class ThumbnailUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ThumbnailUnavailable";
  }
}

// sharp and ffmpeg are the memory hogs on a Pi: two thumbnails at a time for the whole process.
const limiter = createLimiter(2);
const inFlight = new Map<string, Promise<string>>();

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function videoFrame(ffmpeg: string | null, source: string): Promise<Buffer> {
  const opts = { timeoutMs: FFMPEG_TIMEOUT_MS, maxBytes: FFMPEG_MAX_BYTES };
  const base = ["-nostdin", "-loglevel", "error", "-ss"];
  try {
    const frame = await runTool(ffmpeg, [...base, "1", "-i", source, ...FRAME_ARGS], opts);
    if (frame.length > 0) return frame;
    // Seeking past the end of a clip shorter than a second yields nothing: take the first frame.
    return await runTool(ffmpeg, [...base, "0", "-i", source, ...FRAME_ARGS], opts);
  } catch (err) {
    if (err instanceof ToolError) throw new ThumbnailUnavailable(`ffmpeg_${err.reason}`);
    throw err;
  }
}

/** Reads the header only, and refuses an image whose decode would not fit the memory budget. */
async function assertWithinBudget(input: string | Buffer): Promise<void> {
  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new ThumbnailUnavailable("decode_failed");
  }
  const { width, height, channels, depth, isProgressive } = meta;
  if (!width || !height) throw new ThumbnailUnavailable("decode_failed");
  if (width * height > MAX_INPUT_PIXELS) throw new ThumbnailUnavailable("image_too_large");
  const bytesPerSample = depth === "ushort" || depth === "short" ? 2 : depth === "float" ? 4 : 1;
  const raw = width * height * channels * bytesPerSample;
  if (isProgressive && raw > MAX_WHOLE_IMAGE_BYTES) {
    throw new ThumbnailUnavailable("image_too_large");
  }
}

async function render(source: string, size: ThumbnailSize, video: boolean, tools: MediaTools) {
  const input = video ? await videoFrame(tools.ffmpeg, source) : source;
  await assertWithinBudget(input);
  try {
    return await sharp(input, { sequentialRead: true, limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new ThumbnailUnavailable("decode_failed");
  }
}

async function generate(opts: {
  dataDir: string;
  ownerId: string;
  versionId: string;
  size: ThumbnailSize;
  video: boolean;
  tools: MediaTools;
}): Promise<string> {
  const target = thumbPath(opts.dataDir, opts.versionId, opts.size);
  if (await exists(target)) return target;
  const source = blobPath(opts.dataDir, opts.ownerId, opts.versionId);
  if (!(await exists(source))) throw new ThumbnailUnavailable("blob_missing");
  const bytes = await render(source, opts.size, opts.video, opts.tools);
  // Atomic: a reader sees the whole thumbnail or none. The temp name is a fresh UUID beside it.
  const temp = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temp, bytes);
    await rename(temp, target);
  } catch (err) {
    await unlink(temp).catch(() => undefined);
    throw err;
  }
  return target;
}

/**
 * The cached WebP for a version at a size, made on first use. Concurrent requests for the same
 * thumbnail share one job; all jobs share the process-wide limiter. SVG is never rendered: its
 * decoder would follow references in a file a user controls.
 */
export function thumbnailFile(opts: {
  dataDir: string;
  ownerId: string;
  versionId: string;
  mime: string;
  size: ThumbnailSize;
  tools: MediaTools;
}): Promise<string> {
  if (opts.mime === "image/svg+xml") {
    return Promise.reject(new ThumbnailUnavailable("svg_not_rendered"));
  }
  const target = thumbPath(opts.dataDir, opts.versionId, opts.size);
  const running = inFlight.get(target);
  if (running) return running;
  const job = limiter
    .run(() => generate({ ...opts, video: opts.mime.startsWith("video/") }))
    .finally(() => {
      inFlight.delete(target);
    });
  inFlight.set(target, job);
  return job;
}
