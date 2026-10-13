import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { errorResponse } from "@cloud/shared";
import { files } from "../db/schema/index.js";
import { thumbPath } from "../files/storage.js";
import { binary, blobFile, harness, type Harness } from "../testing/harness.js";
import { fakeFfmpeg, jpeg, toolDir } from "../testing/media.js";

type Media = NonNullable<Parameters<typeof harness>[0]>["media"];

async function setup(media?: Media) {
  const h = harness(media ? { media } : {});
  const a = await h.admin();
  const b = await h.member("b@example.com");
  const root = (await a.root()).folder;
  return { h, a, b, root };
}

function versionOf(h: Harness, fileId: string): string {
  const row = h.db.select().from(files).where(eq(files.id, fileId)).get();
  if (!row?.currentVersionId) throw new Error("no version");
  return row.currentVersionId;
}

function code(res: { body: unknown }): string {
  return errorResponse.parse(res.body).error.code;
}

async function dimensions(bytes: unknown) {
  const { width, height, format } = await sharp(bytes as Buffer).metadata();
  return { width, height, format };
}

describe("thumbnails of images", () => {
  it("makes 256 and 1024 WebP thumbnails that fit inside the box and never enlarge", async () => {
    const { a, root } = await setup();
    const big = await a.upload(root.id, "big.jpg", await jpeg({ width: 2000, height: 1000 }));
    const small = await a.upload(root.id, "small.jpg", await jpeg({ width: 40, height: 20 }));

    const t256 = await binary(a.get(`/api/files/${big}/thumbnail?size=256`));
    expect(t256.status).toBe(200);
    expect(t256.get("Content-Type")).toBe("image/webp");
    expect(await dimensions(t256.body)).toEqual({ width: 256, height: 128, format: "webp" });

    const t1024 = await binary(a.get(`/api/files/${big}/thumbnail?size=1024`));
    expect(await dimensions(t1024.body)).toEqual({ width: 1024, height: 512, format: "webp" });

    // The default size is 256, and a small picture stays as it is.
    const dflt = await binary(a.get(`/api/files/${small}/thumbnail`));
    expect(await dimensions(dflt.body)).toMatchObject({ width: 40, height: 20 });
  });

  it("rejects sizes outside the contract", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "p.jpg", await jpeg());
    for (const size of ["512", "0", "abc", "-256"]) {
      const res = await a.get(`/api/files/${id}/thumbnail?size=${size}`);
      expect(res.status, size).toBe(400);
      expect(code(res)).toBe("invalid_request");
    }
  });

  it("respects the EXIF orientation: a sideways picture is turned upright", async () => {
    const { a, root } = await setup();
    const sideways = await jpeg({ width: 40, height: 20, orientation: 6 });
    const id = await a.upload(root.id, "side.jpg", sideways);
    const res = await binary(a.get(`/api/files/${id}/thumbnail?size=256`));
    expect(await dimensions(res.body)).toMatchObject({ width: 20, height: 40 });
  });

  it("serves a cached thumbnail without decoding again", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "p.jpg", await jpeg({ width: 300, height: 200 }));
    const versionId = versionOf(h, id);
    const cached = thumbPath(h.dataDir, versionId, 256);
    expect(existsSync(cached)).toBe(false);

    const first = await binary(a.get(`/api/files/${id}/thumbnail`));
    expect(first.status).toBe(200);
    expect(existsSync(cached)).toBe(true);
    const mtime = statSync(cached).mtimeMs;

    // With the source gone only the cache can answer, and the cached file is not rewritten.
    unlinkSync(blobFile(h.dataDir, a.user.id, versionId));
    const second = await binary(a.get(`/api/files/${id}/thumbnail`));
    expect(second.status).toBe(200);
    expect((second.body as Buffer).equals(first.body as Buffer)).toBe(true);
    expect(statSync(cached).mtimeMs).toBe(mtime);
    expect(readFileSync(cached).equals(first.body as Buffer)).toBe(true);
  });

  it("revalidates with an ETag of version and size and answers 304", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "p.jpg", await jpeg({ width: 300, height: 200 }));
    const versionId = versionOf(h, id);
    const res = await a.get(`/api/files/${id}/thumbnail?size=1024`);
    expect(res.get("ETag")).toBe(`"${versionId}-1024"`);
    expect(res.get("Cache-Control")).toBe("private, no-cache");

    const again = await a
      .get(`/api/files/${id}/thumbnail?size=1024`)
      .set("If-None-Match", `"${versionId}-1024"`);
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
    expect(again.get("ETag")).toBe(`"${versionId}-1024"`);

    // Another size is another tag.
    const other = await a
      .get(`/api/files/${id}/thumbnail?size=256`)
      .set("If-None-Match", `"${versionId}-1024"`);
    expect(other.status).toBe(200);
  });

  it("gets a new thumbnail when a new version replaces the bytes", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "p.jpg", await jpeg({ width: 300, height: 200 }));
    const v1 = versionOf(h, id);
    await a.get(`/api/files/${id}/thumbnail`);
    await a.upload(root.id, "p.jpg", await jpeg({ width: 100, height: 300 }), id);
    const v2 = versionOf(h, id);
    expect(v2).not.toBe(v1);
    const res = await a.get(`/api/files/${id}/thumbnail`).set("If-None-Match", `"${v1}-256"`);
    expect(res.status).toBe(200);
    expect(res.get("ETag")).toBe(`"${v2}-256"`);
  });

  it("answers not_found for files that are not pictures or videos, and for folders", async () => {
    const { a, root } = await setup();
    const text = await a.upload(root.id, "notes.txt", Buffer.from("hello"));
    const noType = await a.upload(root.id, "blob", Buffer.from("hello"));
    for (const id of [text, noType, root.id, "00000000-0000-4000-8000-000000000000"]) {
      const res = await a.get(`/api/files/${id}/thumbnail`);
      expect(res.status, id).toBe(404);
      expect(code(res)).toBe("not_found");
    }
  });

  it("answers thumbnail_unavailable for a corrupt image and for SVG", async () => {
    const { a, root } = await setup();
    const corrupt = await a.upload(root.id, "broken.jpg", Buffer.from("not really a jpeg"));
    const svg = await a.upload(
      root.id,
      "icon.svg",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'),
    );
    for (const id of [corrupt, svg]) {
      const res = await a.get(`/api/files/${id}/thumbnail`);
      expect(res.status, id).toBe(404);
      expect(code(res)).toBe("thumbnail_unavailable");
    }
  });

  it("is scoped to the owner's active files", async () => {
    const { h, a, b, root } = await setup();
    const id = await a.upload(root.id, "p.jpg", await jpeg());
    const anon = await (await import("supertest")).default(h.app).get(`/api/files/${id}/thumbnail`);
    expect(anon.status).toBe(401);

    const foreign = await b.get(`/api/files/${id}/thumbnail`);
    expect(foreign.status).toBe(404);
    expect(code(foreign)).toBe("not_found");

    expect((await a.del(`/api/files/${id}`)).status).toBe(204);
    const trashed = await a.get(`/api/files/${id}/thumbnail`);
    expect(trashed.status).toBe(404);
    expect(code(trashed)).toBe("not_found");
    expect((await a.post(`/api/trash/${id}/restore`)).status).toBe(200);
    expect((await a.get(`/api/files/${id}/thumbnail`)).status).toBe(200);
  });

  it("removes the thumbnails with the file when it is purged from the trash", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "p.jpg", await jpeg({ width: 600, height: 400 }));
    const versionId = versionOf(h, id);
    await a.get(`/api/files/${id}/thumbnail?size=256`);
    await a.get(`/api/files/${id}/thumbnail?size=1024`);
    const paths = [256, 1024].map((s) => thumbPath(h.dataDir, versionId, s));
    expect(paths.every((p) => existsSync(p))).toBe(true);

    await a.del(`/api/files/${id}`);
    expect((await a.del(`/api/trash/${id}`)).status).toBe(204);
    expect(paths.some((p) => existsSync(p))).toBe(false);
  });

  it("removes the thumbnails of a version that is deleted", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "p.jpg", await jpeg({ width: 600, height: 400 }));
    const old = versionOf(h, id);
    await a.get(`/api/files/${id}/thumbnail`);
    await a.upload(root.id, "p.jpg", await jpeg({ width: 400, height: 600 }), id);
    const cached = thumbPath(h.dataDir, old, 256);
    expect(existsSync(cached)).toBe(true);
    expect((await a.del(`/api/files/${id}/versions/${old}`)).status).toBe(204);
    expect(existsSync(cached)).toBe(false);
  });
});

describe("thumbnails of videos", () => {
  const MP4 = Buffer.from("pretend video bytes");

  it("is unavailable when ffmpeg is known to be absent or cannot start", async () => {
    for (const ffmpeg of [null, "/nonexistent/ffmpeg"]) {
      const { a, root } = await setup({ ffmpeg });
      const id = await a.upload(root.id, "clip.mp4", MP4);
      const res = await a.get(`/api/files/${id}/thumbnail`);
      expect(res.status, String(ffmpeg)).toBe(404);
      expect(code(res)).toBe("thumbnail_unavailable");
    }
  });

  it("is unavailable when ffmpeg fails", async () => {
    const dir = toolDir();
    const { path } = await fakeFfmpeg(dir, { fail: true });
    const { a, root } = await setup({ ffmpeg: path });
    const id = await a.upload(root.id, "clip.mp4", MP4);
    const res = await a.get(`/api/files/${id}/thumbnail`);
    expect(res.status).toBe(404);
    expect(code(res)).toBe("thumbnail_unavailable");
  });

  it("takes a frame at one second with an argument list and turns it into WebP", async () => {
    const dir = toolDir();
    const { path, log } = await fakeFfmpeg(dir);
    const { h, a, root } = await setup({ ffmpeg: path });
    const id = await a.upload(root.id, "clip.mp4", MP4);
    const res = await binary(a.get(`/api/files/${id}/thumbnail`));
    expect(res.status).toBe(200);
    expect(res.get("Content-Type")).toBe("image/webp");
    expect(await dimensions(res.body)).toEqual({ width: 64, height: 36, format: "webp" });

    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(1);
    const args = JSON.parse(calls[0] ?? "[]") as string[];
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "1"]);
    expect(args).toContain("-frames:v");
    expect(args[args.indexOf("-i") + 1]).toBe(blobFile(h.dataDir, a.user.id, versionOf(h, id)));
  });

  it("falls back to the first frame for a clip shorter than a second", async () => {
    const dir = toolDir();
    const { path, log } = await fakeFfmpeg(dir, { emptyAtOneSecond: true });
    const { a, root } = await setup({ ffmpeg: path });
    const id = await a.upload(root.id, "short.mp4", MP4);
    const res = await a.get(`/api/files/${id}/thumbnail`);
    expect(res.status).toBe(200);
    const seeks = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const args = JSON.parse(line) as string[];
        return args[args.indexOf("-ss") + 1];
      });
    expect(seeks).toEqual(["1", "0"]);
  });

  it("shares one job between concurrent requests for the same thumbnail", async () => {
    const dir = toolDir();
    const { path, log } = await fakeFfmpeg(dir, { delayMs: 300 });
    const { a, root } = await setup({ ffmpeg: path });
    const id = await a.upload(root.id, "clip.mp4", MP4);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => a.get(`/api/files/${id}/thumbnail`)),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
  });
});
