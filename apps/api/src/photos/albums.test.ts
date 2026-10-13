import { describe, expect, it } from "vitest";
import { album, albumDetail, albumList, errorResponse, photoPage, type Album } from "@cloud/shared";
import { albumItems } from "../db/schema/index.js";
import { harness, type Harness } from "../testing/harness.js";
import { jpeg } from "../testing/media.js";
import { extractPending } from "./media-info.js";

async function setup() {
  const h = harness();
  const a = await h.admin();
  const b = await h.member("b@example.com");
  const root = (await a.root()).folder;
  const rootB = (await b.root()).folder;
  return { h, a, b, root, rootB };
}

type Client = Awaited<ReturnType<typeof setup>>["a"];

const extract = (h: Harness) => extractPending({ db: h.db, dataDir: h.dataDir });

function code(res: { body: unknown }): string {
  return errorResponse.parse(res.body).error.code;
}

async function createAlbum(c: Client, name = "Summer"): Promise<Album> {
  const res = await c.post("/api/albums", { name });
  expect(res.status).toBe(201);
  return album.parse(res.body);
}

async function getAlbum(c: Client, id: string) {
  const res = await c.get(`/api/albums/${id}`);
  expect(res.status).toBe(200);
  return albumDetail.parse(res.body);
}

describe("albums CRUD", () => {
  it("creates, lists newest-updated first, renames and deletes without touching photos", async () => {
    const { h, a, root } = await setup();
    const photo = await a.upload(root.id, "p.jpg", await jpeg());
    h.clock.t = 1_700_000_000_000;
    const first = await createAlbum(a, "  First  ");
    expect(first).toMatchObject({ name: "First", itemCount: 0, coverFileId: null });
    expect(first.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    h.clock.t += 1000;
    const second = await createAlbum(a, "Second");

    let list = albumList.parse((await a.get("/api/albums")).body).albums;
    expect(list.map((x) => x.name)).toEqual(["Second", "First"]);

    h.clock.t += 1000;
    const renamed = await a.patch(`/api/albums/${first.id}`, { name: "Renamed" });
    expect(renamed.status).toBe(200);
    expect(album.parse(renamed.body)).toMatchObject({
      name: "Renamed",
      createdAt: first.createdAt,
      updatedAt: new Date(h.clock.t).toISOString(),
    });
    list = albumList.parse((await a.get("/api/albums")).body).albums;
    expect(list.map((x) => x.name)).toEqual(["Renamed", "Second"]);

    await a.post(`/api/albums/${first.id}/items`, { fileIds: [photo] });
    expect((await a.del(`/api/albums/${first.id}`)).status).toBe(204);
    expect((await a.get(`/api/albums/${first.id}`)).status).toBe(404);
    expect(albumList.parse((await a.get("/api/albums")).body).albums.map((x) => x.id)).toEqual([
      second.id,
    ]);
    expect(photoPage.parse((await a.get("/api/photos")).body).items).toHaveLength(1);
    expect((await a.get(`/api/files/${photo}/content`)).status).toBe(200);
    expect(h.db.select().from(albumItems).all()).toHaveLength(0);
  });

  it("validates names", async () => {
    const { a } = await setup();
    const album1 = await createAlbum(a);
    for (const name of ["", "   ", "x".repeat(121), 7, null]) {
      const created = await a.post("/api/albums", { name });
      expect(created.status, String(name)).toBe(400);
      expect(code(created)).toBe("invalid_request");
      const renamed = await a.patch(`/api/albums/${album1.id}`, { name });
      expect(renamed.status, String(name)).toBe(400);
    }
    expect((await a.post("/api/albums", {})).status).toBe(400);
    expect((await a.post("/api/albums", { name: "x".repeat(120) })).status).toBe(201);
  });
});

describe("album items", () => {
  it("adds photos, ignores duplicates, and counts and covers by the latest addition", async () => {
    const { h, a, root } = await setup();
    const p1 = await a.upload(
      root.id,
      "p1.jpg",
      await jpeg({ dateTimeOriginal: "2020:01:03 00:00:00" }),
    );
    const p2 = await a.upload(
      root.id,
      "p2.jpg",
      await jpeg({ dateTimeOriginal: "2020:01:01 00:00:00" }),
    );
    const v1 = await a.upload(root.id, "v1.mp4", Buffer.from("video"));
    await extract(h);
    const created = await createAlbum(a);

    h.clock.t += 1000;
    const add = await a.post(`/api/albums/${created.id}/items`, { fileIds: [p1, p2, p1] });
    expect(add.status).toBe(204);
    let detail = await getAlbum(a, created.id);
    expect(detail.album).toMatchObject({ itemCount: 2, coverFileId: p2 });
    expect(detail.album.updatedAt).toBe(new Date(h.clock.t).toISOString());

    // Adding again changes nothing, and neither does a request of only duplicates.
    const before = detail.album.updatedAt;
    h.clock.t += 1000;
    expect((await a.post(`/api/albums/${created.id}/items`, { fileIds: [p1] })).status).toBe(204);
    detail = await getAlbum(a, created.id);
    expect(detail.album).toMatchObject({ itemCount: 2, updatedAt: before });

    h.clock.t += 1000;
    await a.post(`/api/albums/${created.id}/items`, { fileIds: [v1] });
    detail = await getAlbum(a, created.id);
    expect(detail.album).toMatchObject({ itemCount: 3, coverFileId: v1 });
    expect(detail.album.updatedAt).toBe(new Date(h.clock.t).toISOString());
    // Oldest first: p2 (2020-01-01), p1 (2020-01-03), then the video (upload time, later).
    expect(detail.items.map((i) => i.fileId)).toEqual([p2, p1, v1]);
    expect(detail.items[0]).toMatchObject({ name: "p2.jpg", kind: "image", takenAtSource: "exif" });
  });

  it("is all or nothing: one bad ID rejects the whole request", async () => {
    const { h, a, b, root, rootB } = await setup();
    const good = await a.upload(root.id, "good.jpg", await jpeg());
    const text = await a.upload(root.id, "notes.txt", Buffer.from("text"));
    const trashed = await a.upload(root.id, "gone.jpg", await jpeg({ color: "#0f0" }));
    await a.del(`/api/files/${trashed}`);
    const foreign = await b.upload(rootB.id, "b.jpg", await jpeg());
    const folder = await a.mkdir(root.id, "dir");
    const missing = "00000000-0000-4000-8000-000000000000";
    const target = await createAlbum(a);
    h.clock.t += 5000;

    for (const bad of [text, trashed, foreign, folder.id, missing, "not-a-uuid"]) {
      const res = await a.post(`/api/albums/${target.id}/items`, { fileIds: [good, bad] });
      expect(res.status, bad).toBe(404);
      expect(code(res)).toBe("not_found");
    }
    const detail = await getAlbum(a, target.id);
    expect(detail.items).toEqual([]);
    expect(detail.album).toMatchObject({ itemCount: 0, updatedAt: target.updatedAt });
    expect(h.db.select().from(albumItems).all()).toHaveLength(0);
  });

  it("validates the request body", async () => {
    const { a } = await setup();
    const created = await createAlbum(a);
    for (const body of [{}, { fileIds: [] }, { fileIds: [1] }, { fileIds: "x" }]) {
      const res = await a.post(`/api/albums/${created.id}/items`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(code(res)).toBe("invalid_request");
    }
    const tooMany = Array.from({ length: 501 }, () => crypto.randomUUID());
    expect((await a.post(`/api/albums/${created.id}/items`, { fileIds: tooMany })).status).toBe(
      400,
    );
  });

  it("removes an item and bumps the album", async () => {
    const { h, a, root } = await setup();
    const p1 = await a.upload(root.id, "p1.jpg", await jpeg());
    const p2 = await a.upload(root.id, "p2.jpg", await jpeg({ color: "#00f" }));
    const created = await createAlbum(a);
    await a.post(`/api/albums/${created.id}/items`, { fileIds: [p1, p2] });

    h.clock.t += 1000;
    expect((await a.del(`/api/albums/${created.id}/items/${p2}`)).status).toBe(204);
    const detail = await getAlbum(a, created.id);
    expect(detail.items.map((i) => i.fileId)).toEqual([p1]);
    expect(detail.album).toMatchObject({
      itemCount: 1,
      coverFileId: p1,
      updatedAt: new Date(h.clock.t).toISOString(),
    });
    // The photo itself stays.
    expect((await a.get(`/api/files/${p2}/content`)).status).toBe(200);

    const again = await a.del(`/api/albums/${created.id}/items/${p2}`);
    expect(again.status).toBe(404);
    expect(code(again)).toBe("not_found");
  });

  it("hides inactive photos and brings them back on restore", async () => {
    const { h, a, root } = await setup();
    const folder = await a.mkdir(root.id, "trip");
    const p1 = await a.upload(
      root.id,
      "p1.jpg",
      await jpeg({ dateTimeOriginal: "2020:01:01 00:00:00" }),
    );
    const p2 = await a.upload(
      folder.id,
      "p2.jpg",
      await jpeg({ dateTimeOriginal: "2020:01:02 00:00:00" }),
    );
    const p3 = await a.upload(
      root.id,
      "p3.jpg",
      await jpeg({ dateTimeOriginal: "2020:01:03 00:00:00" }),
    );
    await extract(h);
    const created = await createAlbum(a);
    h.clock.t += 1000;
    await a.post(`/api/albums/${created.id}/items`, { fileIds: [p1] });
    h.clock.t += 1000;
    await a.post(`/api/albums/${created.id}/items`, { fileIds: [p2] });
    h.clock.t += 1000;
    await a.post(`/api/albums/${created.id}/items`, { fileIds: [p3] });
    expect((await getAlbum(a, created.id)).album).toMatchObject({ itemCount: 3, coverFileId: p3 });

    await a.del(`/api/files/${p3}`);
    let detail = await getAlbum(a, created.id);
    expect(detail.items.map((i) => i.fileId)).toEqual([p1, p2]);
    expect(detail.album).toMatchObject({ itemCount: 2, coverFileId: p2 });

    await a.del(`/api/files/${folder.id}`);
    detail = await getAlbum(a, created.id);
    expect(detail.items.map((i) => i.fileId)).toEqual([p1]);
    expect(detail.album).toMatchObject({ itemCount: 1, coverFileId: p1 });
    const listed = albumList.parse((await a.get("/api/albums")).body).albums;
    expect(listed[0]).toMatchObject({ itemCount: 1, coverFileId: p1 });

    await a.post(`/api/trash/${folder.id}/restore`);
    await a.post(`/api/trash/${p3}/restore`);
    detail = await getAlbum(a, created.id);
    expect(detail.items.map((i) => i.fileId)).toEqual([p1, p2, p3]);
    expect(detail.album).toMatchObject({ itemCount: 3, coverFileId: p3 });
  });

  it("forgets a photo that is purged for good, and an album with only hidden items is empty", async () => {
    const { h, a, root } = await setup();
    const p1 = await a.upload(root.id, "p1.jpg", await jpeg());
    const created = await createAlbum(a);
    await a.post(`/api/albums/${created.id}/items`, { fileIds: [p1] });
    await a.del(`/api/files/${p1}`);
    expect((await getAlbum(a, created.id)).album).toMatchObject({
      itemCount: 0,
      coverFileId: null,
    });
    expect(h.db.select().from(albumItems).all()).toHaveLength(1);
    expect((await a.del(`/api/trash/${p1}`)).status).toBe(204);
    expect(h.db.select().from(albumItems).all()).toHaveLength(0);
    expect((await getAlbum(a, created.id)).items).toEqual([]);
  });
});

describe("album ownership", () => {
  it("gives user B a 404 for everything of user A's", async () => {
    const { a, b, root, rootB } = await setup();
    const photo = await a.upload(root.id, "a.jpg", await jpeg());
    const mine = await b.upload(rootB.id, "b.jpg", await jpeg());
    const albumA = await createAlbum(a, "A's");
    await a.post(`/api/albums/${albumA.id}/items`, { fileIds: [photo] });
    const albumB = await createAlbum(b, "B's");

    const attempts = [
      await b.get(`/api/albums/${albumA.id}`),
      await b.patch(`/api/albums/${albumA.id}`, { name: "mine now" }),
      await b.del(`/api/albums/${albumA.id}`),
      await b.post(`/api/albums/${albumA.id}/items`, { fileIds: [mine] }),
      await b.del(`/api/albums/${albumA.id}/items/${photo}`),
      // B's own album, A's photo.
      await b.post(`/api/albums/${albumB.id}/items`, { fileIds: [photo] }),
      await b.post(`/api/albums/${albumB.id}/items`, { fileIds: [mine, photo] }),
      await b.del(`/api/albums/${albumB.id}/items/${photo}`),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(404);
      expect(code(res)).toBe("not_found");
    }

    expect(albumList.parse((await b.get("/api/albums")).body).albums.map((x) => x.id)).toEqual([
      albumB.id,
    ]);
    expect(await getAlbum(b, albumB.id)).toMatchObject({ items: [], album: { itemCount: 0 } });
    // Nothing of A's changed.
    const detail = await getAlbum(a, albumA.id);
    expect(detail.album).toMatchObject({ name: "A's", itemCount: 1, coverFileId: photo });
  });

  it("requires a session on every albums endpoint", async () => {
    const { h, a } = await setup();
    const created = await createAlbum(a);
    const { default: request } = await import("supertest");
    const origin = "http://localhost:3000";
    const calls = [
      request(h.app).get("/api/albums"),
      request(h.app).post("/api/albums").set("Origin", origin).send({ name: "x" }),
      request(h.app).get(`/api/albums/${created.id}`),
      request(h.app).patch(`/api/albums/${created.id}`).set("Origin", origin).send({ name: "x" }),
      request(h.app).delete(`/api/albums/${created.id}`).set("Origin", origin),
      request(h.app)
        .post(`/api/albums/${created.id}/items`)
        .set("Origin", origin)
        .send({ fileIds: ["x"] }),
      request(h.app).delete(`/api/albums/${created.id}/items/x`).set("Origin", origin),
    ];
    for (const call of calls) {
      const res = await call;
      expect(res.status).toBe(401);
      expect(code(res)).toBe("unauthenticated");
    }
  });
});
