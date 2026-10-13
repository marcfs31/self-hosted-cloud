import { sql } from "drizzle-orm";
import exifr from "exifr";
import sharp from "sharp";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { blobPath } from "../files/storage.js";
import { mediaKind } from "./kinds.js";
import { DEFAULT_MEDIA_TOOLS, ToolError, runTool, type MediaTools } from "./tools.js";

export const EXTRACT_BATCH = 50;
const FFPROBE_TIMEOUT_MS = 20_000;
const FFPROBE_MAX_BYTES = 1024 * 1024;
const EXIF_MIN_MS = Date.UTC(1900, 0, 1);
/** Rules out the zero dates (1970, and QuickTime's 1904) that cameras and muxers write. */
const VIDEO_MIN_MS = Date.UTC(1971, 0, 1);

export interface MediaFacts {
  takenAt: Date | null;
  width: number | null;
  height: number | null;
  error: string | null;
}

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\0/g, "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * EXIF stores a wall-clock time without a zone. With an OffsetTime* tag the instant is exact;
 * without one the wall clock is read as UTC (the camera's zone is unknown), which can be off by
 * the camera's UTC offset but keeps the order of one camera's photos intact.
 */
export function parseExifDate(dateValue: unknown, offsetValue: unknown): Date | null {
  const raw = text(dateValue);
  const match = raw ? EXIF_DATE.exec(raw) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() !== month - 1 ||
    wall.getUTCDate() !== day ||
    wall.getUTCHours() !== hour ||
    wall.getUTCMinutes() !== minute ||
    wall.getUTCSeconds() !== second
  ) {
    return null;
  }
  const zone = EXIF_OFFSET.exec(text(offsetValue) ?? "");
  const offsetMinutes = zone
    ? (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3]))
    : 0;
  const instant = new Date(wall.getTime() - offsetMinutes * 60_000);
  return instant.getTime() >= EXIF_MIN_MS ? instant : null;
}

async function exifDate(path: string): Promise<Date | null> {
  try {
    const tags = (await exifr.parse(path, {
      pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTimeDigitized"],
      reviveValues: false,
      translateValues: false,
    })) as Record<string, unknown> | undefined;
    if (!tags) return null;
    return (
      parseExifDate(tags.DateTimeOriginal, tags.OffsetTimeOriginal) ??
      parseExifDate(tags.CreateDate, tags.OffsetTimeDigitized)
    );
  } catch {
    // exifr throws on formats without EXIF (PNG, GIF, ...): the upload time stands in.
    return null;
  }
}

/** Display dimensions: EXIF orientations 5 to 8 turn the picture on its side. */
async function imageSize(path: string): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height, orientation } = await sharp(path).metadata();
    if (!width || !height) return null;
    const sideways = orientation !== undefined && orientation >= 5 && orientation <= 8;
    return sideways ? { width: height, height: width } : { width, height };
  } catch {
    return null;
  }
}

async function readImage(path: string): Promise<MediaFacts> {
  const [takenAt, size] = await Promise.all([exifDate(path), imageSize(path)]);
  return {
    takenAt,
    width: size?.width ?? null,
    height: size?.height ?? null,
    error: takenAt === null && size === null ? "unreadable" : null,
  };
}

const probeOutput = z.object({
  format: z.object({ tags: z.record(z.string(), z.unknown()).optional() }).optional(),
  streams: z
    .array(
      z.object({
        codec_type: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        tags: z.record(z.string(), z.unknown()).optional(),
        side_data_list: z.array(z.object({ rotation: z.number().optional() }).loose()).optional(),
      }),
    )
    .optional(),
});

function creationTime(tags: Record<string, unknown> | undefined): Date | null {
  const value = text(tags?.creation_time);
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) || at.getTime() < VIDEO_MIN_MS ? null : at;
}

async function readVideo(path: string, tools: MediaTools): Promise<MediaFacts> {
  const none: MediaFacts = { takenAt: null, width: null, height: null, error: null };
  let out: Buffer;
  try {
    out = await runTool(
      tools.ffprobe,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
      { timeoutMs: FFPROBE_TIMEOUT_MS, maxBytes: FFPROBE_MAX_BYTES },
    );
  } catch (err) {
    const unavailable = err instanceof ToolError && err.reason === "unavailable";
    return { ...none, error: unavailable ? "ffprobe_unavailable" : "ffprobe_failed" };
  }
  let probe: z.infer<typeof probeOutput>;
  try {
    probe = probeOutput.parse(JSON.parse(out.toString("utf8")));
  } catch {
    return { ...none, error: "ffprobe_failed" };
  }
  const streams = probe.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && s.width && s.height);
  const rotation = Math.abs(
    video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
      Number(text(video?.tags?.rotate) ?? 0),
  );
  const sideways = rotation % 180 === 90;
  const width = video?.width ?? null;
  const height = video?.height ?? null;
  return {
    takenAt:
      creationTime(probe.format?.tags) ??
      streams.map((s) => creationTime(s.tags)).find(Boolean) ??
      null,
    width: sideways ? height : width,
    height: sideways ? width : height,
    error: null,
  };
}

/** Read the date and size of one stored version. Never throws for a bad file: it reports `error`. */
export async function readMediaFacts(
  path: string,
  mime: string,
  tools: MediaTools,
): Promise<MediaFacts> {
  try {
    return mediaKind(mime) === "video" ? await readVideo(path, tools) : await readImage(path);
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    return {
      takenAt: null,
      width: null,
      height: null,
      error: missing ? "blob_missing" : "unreadable",
    };
  }
}

interface PendingRow {
  id: string;
  owner_id: string;
  mime: string;
}

/**
 * Fill media_info for up to `limit` current versions that have none, newest first, one at a time.
 * A version that cannot be read gets a row with `error` set, so it is not tried again. Returns
 * how many versions were handled; a full batch means more may be waiting.
 */
export async function extractPending(opts: {
  db: Db;
  dataDir: string;
  limit?: number;
  tools?: MediaTools;
  now?: () => number;
}): Promise<number> {
  const { db, dataDir, limit = EXTRACT_BATCH, tools = DEFAULT_MEDIA_TOOLS, now = Date.now } = opts;
  const pending = db.all<PendingRow>(sql`
    select v.id, v.owner_id, v.mime
      from file_versions v
      join files f on f.current_version_id = v.id
     where (v.mime like 'image/%' or v.mime like 'video/%')
       and not exists (select 1 from media_info m where m.version_id = v.id)
     order by v.created_at desc, v.rowid desc
     limit ${limit}`);
  for (const row of pending) {
    const facts = await readMediaFacts(blobPath(dataDir, row.owner_id, row.id), row.mime, tools);
    // The version may have been purged while its bytes were read: insert only if it still exists.
    db.run(sql`
      insert or ignore into media_info (version_id, taken_at, width, height, extracted_at, error)
      select ${row.id}, ${facts.takenAt?.getTime() ?? null}, ${facts.width}, ${facts.height},
             ${now()}, ${facts.error}
       where exists (select 1 from file_versions where id = ${row.id})`);
  }
  return pending.length;
}
