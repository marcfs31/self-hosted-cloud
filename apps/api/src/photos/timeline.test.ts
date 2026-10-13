import { describe, expect, it } from "vitest";
import { errorResponse, photoPage, type PhotoItem } from "@cloud/shared";
import { fileVersions, files } from "../db/schema/index.js";
import { harness, type Harness } from "../testing/harness.js";
import { jpeg } from "../testing/media.js";
import { extractPending } from "./media-info.js";

async function setup() {
  const h = harness();
  const a = await h.admin();
  const b = await h.member("b@example.com");
  const root = (await a.root()).folder;
  return { h, a, b, root };
}

type Client = Awaited<ReturnType<typeof setup>>["a"];

async function page(c: Client, query = "") {
  const res = await c.get(`/api/photos${query}`);
  expect(res.status).toBe(200);
  return photoPage.parse(res.body);
}

async function allPages(c: Client, limit: number): Promise<PhotoItem[]> {
  const items: PhotoItem[] = [];
  let cursor: string | null = null;
  do {
    const next = await page(c, `?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
    items.push(...next.items);
    cursor = next.nextCursor;
  } while (cursor);
  return items;
}

const extract = (h: Harness) => extractPending({ db: h.db, dataDir: h.dataDir });

describe("GET /photos", () => {
  it("orders by taken date, newest first, and says where each date came from", async () => {
    const { h, a, root } = await setup();
    const old = await a.upload(
      root.id,
      "old.jpg",
      await jpeg({ width: 30, height: 20, dateTimeOriginal: "2015:05:05 10:00:00" }),
    );
    const recent = await a.upload(
      root.id,
      "recent.jpg",
      await jpeg({ dateTimeOriginal: "2024:01:01 10:00:00" }),
    );
    h.clock.t = Date.UTC(2020, 5, 6, 7, 8, 9);
    const noExif = await a.upload(root.id, "no-exif.jpg", await jpeg());
    await a.upload(root.id, "notes.txt", Buffer.from("not a photo"));
    await extract(h);

    const { items, nextCursor } = await page(a);
    expect(nextCursor).toBeNull();
    expect(items.map((i) => i.fileId)).toEqual([recent, noExif, old]);
    expect(items.map((i) => i.takenAtSource)).toEqual(["exif", "upload", "exif"]);
    expect(items[0]).toMatchObject({
      name: "recent.jpg",
      mime: "image/jpeg",
      kind: "image",
      takenAt: "2024-01-01T10:00:00.000Z",
      width: 40,
      height: 20,
    });
    expect(items[1]?.takenAt).toBe("2020-06-06T07:08:09.000Z");
    expect(items[2]).toMatchObject({ width: 30, height: 20 });
  });

  it("lists a photo from its upload time before its date has been read", async () => {
    const { a, root } = await setup();
    await a.upload(root.id, "a.jpg", await jpeg({ dateTimeOriginal: "2001:01:01 00:00:00" }));
    const { items } = await page(a);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ takenAtSource: "upload", width: null, height: null });
  });

  it("includes videos with kind video", async () => {
    const { a, root } = await setup();
    await a.upload(root.id, "clip.mp4", Buffer.from("video"));
    expect((await page(a)).items[0]).toMatchObject({ kind: "video", mime: "video/mp4" });
  });

  it("pages stably through photos that share one timestamp", async () => {
    const { h, a, root } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      ids.push(
        await a.upload(
          root.id,
          `p${i}.jpg`,
          await jpeg({ dateTimeOriginal: "2022:02:02 02:02:02", color: `#${i}00` }),
        ),
      );
    }
    // Three more share one upload time.
    for (let i = 0; i < 3; i += 1) ids.push(await a.upload(root.id, `q${i}.jpg`, await jpeg()));
    await extract(h);

    const first = await page(a, "?limit=4");
    expect(first.items).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();
    const all = await allPages(a, 4);
    expect(all).toHaveLength(10);
    expect(new Set(all.map((i) => i.fileId))).toEqual(new Set(ids));

    const keys = all.map((i) => `${i.takenAt}|${i.fileId}`);
    expect(keys).toEqual([...keys].sort().reverse());
    // The same pages again, and in one go, agree.
    expect((await allPages(a, 3)).map((i) => i.fileId)).toEqual(all.map((i) => i.fileId));
    expect((await page(a, "?limit=200")).items.map((i) => i.fileId)).toEqual(
      all.map((i) => i.fileId),
    );
  });

  it("keeps its place when a newer photo arrives between pages", async () => {
    const { h, a, root } = await setup();
    for (let i = 0; i < 4; i += 1) {
      await a.upload(
        root.id,
        `p${i}.jpg`,
        await jpeg({ dateTimeOriginal: `2020:01:0${i + 1} 00:00:00` }),
      );
    }
    await extract(h);
    const first = await page(a, "?limit=2");
    await a.upload(root.id, "new.jpg", await jpeg({ dateTimeOriginal: "2030:01:01 00:00:00" }));
    await extract(h);
    const second = await page(a, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((i) => i.name)).toEqual(["p1.jpg", "p0.jpg"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects bad cursors and limits", async () => {
    const { a } = await setup();
    const forged = Buffer.from(JSON.stringify(["x", 1])).toString("base64url");
    for (const query of [
      "?cursor=not-a-cursor",
      `?cursor=${forged}`,
      "?cursor=" + "A".repeat(201),
      "?limit=0",
      "?limit=201",
      "?limit=many",
    ]) {
      const res = await a.get(`/api/photos${query}`);
      expect(res.status, query).toBe(400);
      expect(errorResponse.parse(res.body).error.code).toBe("invalid_request");
    }
  });

  it("hides trashed photos and photos in trashed folders until they are restored", async () => {
    const { h, a, root } = await setup();
    const trip = await a.mkdir(root.id, "trip");
    const inner = await a.mkdir(trip.id, "inner");
    const loose = await a.upload(
      root.id,
      "loose.jpg",
      await jpeg({ dateTimeOriginal: "2020:01:01 00:00:00" }),
    );
    const inTrip = await a.upload(
      trip.id,
      "trip.jpg",
      await jpeg({ dateTimeOriginal: "2020:01:02 00:00:00" }),
    );
    const deep = await a.upload(
      inner.id,
      "deep.jpg",
      await jpeg({ dateTimeOriginal: "2020:01:03 00:00:00" }),
    );
    await extract(h);
    expect((await page(a)).items.map((i) => i.fileId)).toEqual([deep, inTrip, loose]);

    await a.del(`/api/files/${loose}`);
    expect((await page(a)).items.map((i) => i.fileId)).toEqual([deep, inTrip]);
    await a.del(`/api/files/${trip.id}`);
    expect((await page(a)).items).toEqual([]);

    await a.post(`/api/trash/${trip.id}/restore`);
    expect((await page(a)).items.map((i) => i.fileId)).toEqual([deep, inTrip]);
    await a.post(`/api/trash/${loose}/restore`);
    expect((await page(a)).items.map((i) => i.fileId)).toEqual([deep, inTrip, loose]);
  });

  it("shows each user only their own photos", async () => {
    const { h, a, b, root } = await setup();
    const rootB = (await b.root()).folder;
    const mine = await a.upload(root.id, "a.jpg", await jpeg());
    const theirs = await b.upload(rootB.id, "b.jpg", await jpeg());
    await extract(h);
    expect((await page(a)).items.map((i) => i.fileId)).toEqual([mine]);
    expect((await page(b)).items.map((i) => i.fileId)).toEqual([theirs]);
    // A cursor from one user's timeline gives the other nothing of the first's.
    const cursor = Buffer.from(JSON.stringify([Date.now() + 1e9, mine])).toString("base64url");
    expect((await page(b, `?cursor=${cursor}`)).items.map((i) => i.fileId)).toEqual([theirs]);
  });

  it("requires a session", async () => {
    const { h } = await setup();
    const { default: request } = await import("supertest");
    const res = await request(h.app).get("/api/photos");
    expect(res.status).toBe(401);
    expect(errorResponse.parse(res.body).error.code).toBe("unauthenticated");
  });

  it("pages through 5 000 photos with a trashed folder in the way", async () => {
    const { h, a, root } = await setup();
    const trashed = await a.mkdir(root.id, "trashed");
    const userId = a.user.id;
    const at = new Date(1_700_000_000_000);
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      id: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      parentId: i % 10 === 0 ? trashed.id : root.id,
      i,
    }));
    h.db.transaction((tx) => {
      for (const r of rows) {
        tx.insert(files)
          .values({
            id: r.id,
            ownerId: userId,
            parentId: r.parentId,
            name: `p${r.i}.jpg`,
            kind: "file",
            currentVersionId: r.versionId,
            createdAt: at,
            updatedAt: at,
          })
          .run();
        tx.insert(fileVersions)
          .values({
            id: r.versionId,
            fileId: r.id,
            ownerId: userId,
            size: 1,
            sha256: "x",
            mime: "image/jpeg",
            createdAt: new Date(at.getTime() + (r.i % 250) * 1000),
          })
          .run();
      }
    });
    await a.del(`/api/files/${trashed.id}`);

    const started = performance.now();
    const items = await allPages(a, 200);
    const elapsed = performance.now() - started;
    expect(items).toHaveLength(4500);
    expect(new Set(items.map((i) => i.fileId)).size).toBe(4500);
    const keys = items.map((i) => `${i.takenAt}|${i.fileId}`);
    expect(keys).toEqual([...keys].sort().reverse());
    expect(elapsed).toBeLessThan(5000);
  });
});
