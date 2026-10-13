import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { files, mediaInfo } from "../db/schema/index.js";
import { harness, type Harness } from "../testing/harness.js";
import { fakeFfprobe, jpeg, png, toolDir } from "../testing/media.js";
import { extractPending, parseExifDate } from "./media-info.js";

async function setup() {
  const h = harness();
  const a = await h.admin();
  const root = (await a.root()).folder;
  return { h, a, root };
}

function infoOf(h: Harness, fileId: string) {
  const file = h.db.select().from(files).where(eq(files.id, fileId)).get();
  const versionId = file?.currentVersionId ?? "";
  return h.db.select().from(mediaInfo).where(eq(mediaInfo.versionId, versionId)).get();
}

const extract = (h: Harness, extra: Partial<Parameters<typeof extractPending>[0]> = {}) =>
  extractPending({ db: h.db, dataDir: h.dataDir, ...extra });

describe("parseExifDate", () => {
  it("reads the wall clock as UTC when there is no offset", () => {
    expect(parseExifDate("2021:03:04 05:06:07", undefined)?.toISOString()).toBe(
      "2021-03-04T05:06:07.000Z",
    );
  });

  it("applies OffsetTimeOriginal when present", () => {
    expect(parseExifDate("2021:03:04 05:06:07", "+02:00")?.toISOString()).toBe(
      "2021-03-04T03:06:07.000Z",
    );
    expect(parseExifDate("2021:03:04 05:06:07", "-05:30")?.toISOString()).toBe(
      "2021-03-04T10:36:07.000Z",
    );
    expect(parseExifDate("2021:03:04 05:06:07", "junk")?.toISOString()).toBe(
      "2021-03-04T05:06:07.000Z",
    );
  });

  it("rejects dates that do not exist or are unset", () => {
    for (const bad of [
      "0000:00:00 00:00:00",
      "2021:13:04 05:06:07",
      "2021:02:30 05:06:07",
      "2021:03:04 25:06:07",
      "  ",
      "yesterday",
      42,
      null,
    ]) {
      expect(parseExifDate(bad, undefined), String(bad)).toBeNull();
    }
  });
});

describe("extractPending", () => {
  it("reads the taken date and the size from EXIF", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(
      root.id,
      "a.jpg",
      await jpeg({ width: 60, height: 30, dateTimeOriginal: "2021:03:04 05:06:07" }),
    );
    expect(await extract(h)).toBe(1);
    expect(infoOf(h, id)).toMatchObject({ width: 60, height: 30, error: null });
    expect(infoOf(h, id)?.takenAt?.toISOString()).toBe("2021-03-04T05:06:07.000Z");
  });

  it("uses OffsetTimeOriginal when the camera wrote one", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(
      root.id,
      "a.jpg",
      await jpeg({ dateTimeOriginal: "2021:03:04 05:06:07", offsetTimeOriginal: "+02:00" }),
    );
    await extract(h);
    expect(infoOf(h, id)?.takenAt?.toISOString()).toBe("2021-03-04T03:06:07.000Z");
  });

  it("swaps the size of a picture stored sideways", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(
      root.id,
      "a.jpg",
      await jpeg({ width: 40, height: 20, orientation: 6 }),
    );
    await extract(h);
    expect(infoOf(h, id)).toMatchObject({ width: 20, height: 40 });
  });

  it("records a picture without EXIF with a size and no date, and no error", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "plain.png", await png(12, 8));
    await extract(h);
    const info = infoOf(h, id);
    expect(info).toMatchObject({ takenAt: null, width: 12, height: 8, error: null });
  });

  it("records a failure once and does not retry it", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "broken.jpg", Buffer.from("definitely not a jpeg"));
    expect(await extract(h)).toBe(1);
    const first = infoOf(h, id);
    expect(first).toMatchObject({ takenAt: null, width: null, height: null, error: "unreadable" });

    h.clock.t += 60_000;
    expect(await extract(h, { now: () => h.clock.t })).toBe(0);
    expect(infoOf(h, id)?.extractedAt).toEqual(first?.extractedAt);
    expect(h.db.select().from(mediaInfo).all()).toHaveLength(1);
  });

  it("skips non-media files and the old versions of a file", async () => {
    const { h, a, root } = await setup();
    await a.upload(root.id, "notes.txt", Buffer.from("hello"));
    const id = await a.upload(
      root.id,
      "p.jpg",
      await jpeg({ dateTimeOriginal: "2020:01:01 00:00:00" }),
    );
    await a.upload(root.id, "p.jpg", await jpeg({ dateTimeOriginal: "2022:02:02 00:00:00" }), id);
    expect(await extract(h)).toBe(1);
    expect(infoOf(h, id)?.takenAt?.toISOString()).toBe("2022-02-02T00:00:00.000Z");
    expect(h.db.select().from(mediaInfo).all()).toHaveLength(1);
  });

  it("handles at most `limit` versions per call, newest first", async () => {
    const { h, a, root } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      h.clock.t += 1000;
      ids.push(await a.upload(root.id, `p${i}.jpg`, await jpeg({ color: `#${i}${i}${i}` })));
    }
    expect(await extract(h, { limit: 2 })).toBe(2);
    expect(infoOf(h, ids[4] ?? "")).toBeDefined();
    expect(infoOf(h, ids[3] ?? "")).toBeDefined();
    expect(infoOf(h, ids[2] ?? "")).toBeUndefined();
    expect(await extract(h, { limit: 2 })).toBe(2);
    expect(await extract(h, { limit: 2 })).toBe(1);
    expect(await extract(h, { limit: 2 })).toBe(0);
  });

  it("drops the row with the version", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "p.jpg", await jpeg());
    await extract(h);
    await a.del(`/api/files/${id}`);
    await a.del(`/api/trash/${id}`);
    expect(h.db.select().from(mediaInfo).all()).toHaveLength(0);
  });
});

describe("extractPending for videos", () => {
  const probe = {
    format: { tags: { creation_time: "2023-07-08T09:10:11.000000Z" } },
    streams: [{ codec_type: "audio" }, { codec_type: "video", width: 1920, height: 1080 }],
  };

  it("reads creation time and size with ffprobe", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "clip.mp4", Buffer.from("video"));
    await extract(h, { tools: { ffmpeg: null, ffprobe: fakeFfprobe(toolDir(), probe) } });
    expect(infoOf(h, id)).toMatchObject({ width: 1920, height: 1080, error: null });
    expect(infoOf(h, id)?.takenAt?.toISOString()).toBe("2023-07-08T09:10:11.000Z");
  });

  it("swaps the size of a rotated video and ignores zero dates", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "clip.mov", Buffer.from("video"));
    const rotated = {
      format: { tags: { creation_time: "1904-01-01T00:00:00.000000Z" } },
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
        },
      ],
    };
    await extract(h, { tools: { ffmpeg: null, ffprobe: fakeFfprobe(toolDir(), rotated) } });
    expect(infoOf(h, id)).toMatchObject({ takenAt: null, width: 1080, height: 1920, error: null });
  });

  it("records ffprobe_unavailable without a date or size when ffprobe is absent", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "clip.mp4", Buffer.from("video"));
    await extract(h, { tools: { ffmpeg: null, ffprobe: null } });
    expect(infoOf(h, id)).toMatchObject({
      takenAt: null,
      width: null,
      height: null,
      error: "ffprobe_unavailable",
    });
    expect(await extract(h, { tools: { ffmpeg: null, ffprobe: null } })).toBe(0);
  });

  it("records ffprobe_failed when its output cannot be understood", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "clip.mp4", Buffer.from("video"));
    await extract(h, { tools: { ffmpeg: null, ffprobe: fakeFfprobe(toolDir(), "not an object") } });
    expect(infoOf(h, id)?.error).toBe("ffprobe_failed");
  });
});
