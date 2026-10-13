import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorResponse, usageResponse, versionListing } from "@cloud/shared";
import { fileVersions } from "../db/schema/index.js";
import { ORIGIN, binary, blobFile, harness, type Harness } from "../testing/harness.js";

function errorCode(res: { body: unknown }): string {
  return errorResponse.parse(res.body).error.code;
}

async function setup(h: Harness) {
  const a = await h.admin();
  const b = await h.member("b@example.com");
  const aRoot = (await a.root()).folder;
  const bRoot = (await b.root()).folder;
  return { a, b, aRoot, bRoot };
}

function blobsOnDisk(h: Harness): string[] {
  const dir = join(h.dataDir, "files");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
}

function tempEntries(h: Harness): string[] {
  return readdirSync(join(h.dataDir, "tmp", "uploads"));
}

describe("tus upload flow", () => {
  it("creates, patches, commits and serves the bytes back unchanged", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const bytes = randomBytes(300_000);

    const created = await a.tusCreate({ filename: "photo.png", parentId: aRoot.id }, bytes.length);
    expect(created.status).toBe(201);
    expect(created.get("Tus-Resumable")).toBe("1.0.0");
    const location = created.get("Location") ?? "";
    expect(location).toMatch(/^\/api\/uploads\/[0-9a-f-]{36}$/);

    const done = await a.tusPatch(location, 0, bytes);
    expect(done.status).toBe(204);
    expect(done.get("Upload-Offset")).toBe(String(bytes.length));
    const fileId = done.get("Cloud-File-Id") ?? "";
    expect(fileId).toMatch(/^[0-9a-f-]{36}$/);

    const listing = await a.folder(aRoot.id);
    expect(listing.children).toHaveLength(1);
    expect(listing.children[0]).toMatchObject({
      id: fileId,
      name: "photo.png",
      kind: "file",
      size: bytes.length,
      mime: "image/png",
      versionCount: 1,
    });
    const versions = versionListing.parse((await a.get(`/api/files/${fileId}/versions`)).body);
    expect(versions.versions[0]?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));

    const download = await binary(a.get(`/api/files/${fileId}/content`));
    expect(download.body).toEqual(bytes);
    expect(tempEntries(h)).toEqual([]);

    const blob = blobFile(h.dataDir, a.user.id, versions.versions[0]?.id ?? "");
    expect(readFileSync(blob)).toEqual(bytes);
    expect(blob).not.toContain("photo");
  });

  it("resumes: the offset survives and the rest commits the whole file", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const bytes = randomBytes(10_000);
    const created = await a.tusCreate({ filename: "big.bin", parentId: aRoot.id }, bytes.length);
    const location = created.get("Location") ?? "";

    const first = await a.tusPatch(location, 0, bytes.subarray(0, 4_000));
    expect(first.status).toBe(204);
    expect(first.get("Cloud-File-Id")).toBeUndefined();
    expect((await a.folder(aRoot.id)).children).toEqual([]);

    const head = await a.tusHead(location);
    expect(head.status).toBe(200);
    expect(head.get("Upload-Offset")).toBe("4000");
    expect(head.get("Upload-Length")).toBe("10000");

    const wrong = await a.tusPatch(location, 0, bytes.subarray(4_000));
    expect(wrong.status).toBe(409);

    const rest = await a.tusPatch(location, 4_000, bytes.subarray(4_000));
    expect(rest.status).toBe(204);
    const fileId = rest.get("Cloud-File-Id") ?? "";
    expect((await binary(a.get(`/api/files/${fileId}/content`))).body).toEqual(bytes);
  });

  it("accepts an empty file and derives MIME types from the extension only", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const names: Record<string, string> = {
      "empty.txt": "text/plain",
      "IMG_1.HEIC": "image/heic",
      "clip.mov": "video/quicktime",
      "movie.mkv": "video/x-matroska",
      "notes.md": "text/markdown",
      "data.json": "application/json",
      "table.csv": "text/csv",
      "doc.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "archive.zip": "application/zip",
      noextension: "application/octet-stream",
      ".hidden": "application/octet-stream",
    };
    for (const name of Object.keys(names)) {
      await a.upload(
        aRoot.id,
        name,
        name === "empty.txt" ? Buffer.alloc(0) : Buffer.from("<html>"),
      );
    }
    const listing = await a.folder(aRoot.id);
    expect(Object.fromEntries(listing.children.map((c) => [c.name, c.mime]))).toEqual(names);
    expect(listing.children.find((c) => c.name === "empty.txt")?.size).toBe(0);
  });

  it("validates the metadata and the target", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const file = await a.upload(aRoot.id, "plain.txt", Buffer.from("x"));
    const other = await a.mkdir(aRoot.id, "other");
    const inOther = await a.upload(other.id, "inner.txt", Buffer.from("y"));
    const trashed = await a.mkdir(aRoot.id, "trashed");
    await a.del(`/api/files/${trashed.id}`);

    const bad: [string, Record<string, string>, number, string][] = [
      ["no filename", { parentId: aRoot.id }, 400, "invalid_request"],
      ["no parentId", { filename: "a.txt" }, 400, "invalid_request"],
      ["slash in name", { filename: "a/b", parentId: aRoot.id }, 400, "invalid_request"],
      ["dot-dot name", { filename: "..", parentId: aRoot.id }, 400, "invalid_request"],
      ["long name", { filename: "n".repeat(256), parentId: aRoot.id }, 400, "invalid_request"],
      ["file as parent", { filename: "a.txt", parentId: file }, 404, "not_found"],
      ["unknown parent", { filename: "a.txt", parentId: crypto.randomUUID() }, 404, "not_found"],
      ["trashed parent", { filename: "a.txt", parentId: trashed.id }, 404, "not_found"],
      [
        "folder as replaceId",
        { filename: "a", parentId: aRoot.id, replaceId: other.id },
        404,
        "not_found",
      ],
      [
        "replaceId elsewhere",
        { filename: "a", parentId: aRoot.id, replaceId: inOther },
        404,
        "not_found",
      ],
    ];
    for (const [label, meta, status, code] of bad) {
      const res = await a.tusCreate(meta, 3);
      expect(res.status, label).toBe(status);
      expect(res.get("Content-Type"), label).toMatch(/application\/json/);
      expect(errorCode(res), label).toBe(code);
    }
    expect(tempEntries(h)).toEqual([]);
  });

  it("answers every tus error as JSON {error:{code}}", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const meta = `filename ${Buffer.from("a.txt").toString("base64")},parentId ${Buffer.from(aRoot.id).toString("base64")}`;
    const noVersion = await request(h.app)
      .post("/api/uploads")
      .set("Origin", ORIGIN)
      .set("Cookie", a.cookie)
      .set("Upload-Length", "3")
      .set("Upload-Metadata", meta);
    const noLength = await a
      .post("/api/uploads")
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Metadata", meta);
    const deferred = await a
      .post("/api/uploads")
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Defer-Length", "1")
      .set("Upload-Metadata", meta);
    const garbage = await a
      .post("/api/uploads")
      .set("Tus-Resumable", "1.0.0")
      .set("Upload-Length", "3")
      .set("Upload-Metadata", "not valid metadata");
    const getById = await a.get(`/api/uploads/${crypto.randomUUID()}`);
    const missing = await a.tusDelete(`/api/uploads/${crypto.randomUUID()}`);
    const traversal = await a.tusDelete("/api/uploads/..%2f..%2fetc");
    const anonymous = await request(h.app).post("/api/uploads").set("Origin", ORIGIN);

    for (const [label, res, status, code] of [
      ["no Tus-Resumable", noVersion, 412, "invalid_request"],
      ["no length", noLength, 400, "invalid_request"],
      ["deferred length", deferred, 501, "invalid_request"],
      ["bad metadata", garbage, 400, "invalid_request"],
      ["GET", getById, 404, "not_found"],
      ["unknown upload", missing, 404, "not_found"],
      ["traversal id", traversal, 404, "not_found"],
      ["anonymous", anonymous, 401, "unauthenticated"],
    ] as const) {
      expect(res.status, label).toBe(status);
      expect(res.get("Content-Type"), label).toMatch(/application\/json/);
      expect(errorCode(res), label).toBe(code);
    }
  });

  it("rejects tus POST, PATCH and DELETE without an Origin header", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const created = await a.tusCreate({ filename: "a.txt", parentId: aRoot.id }, 3);
    const location = created.get("Location") ?? "";
    const meta = `filename ${Buffer.from("a.txt").toString("base64")},parentId ${Buffer.from(aRoot.id).toString("base64")}`;
    const results = [
      await request(h.app)
        .post("/api/uploads")
        .set("Cookie", a.cookie)
        .set("Tus-Resumable", "1.0.0")
        .set("Upload-Length", "3")
        .set("Upload-Metadata", meta),
      await request(h.app)
        .patch(location)
        .set("Cookie", a.cookie)
        .set("Tus-Resumable", "1.0.0")
        .set("Content-Type", "application/offset+octet-stream")
        .set("Upload-Offset", "0")
        .send(Buffer.from("abc")),
      await request(h.app).delete(location).set("Cookie", a.cookie).set("Tus-Resumable", "1.0.0"),
    ];
    for (const res of results) {
      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe("origin_rejected");
    }
    expect((await a.tusHead(location)).get("Upload-Offset")).toBe("0");
  });
});

describe("tus upload ownership", () => {
  it("hides user A's upload URL from user B and refuses uploads into A's tree", async () => {
    const h = harness();
    const { a, b, aRoot, bRoot } = await setup(h);
    const aFile = await a.upload(aRoot.id, "a.txt", Buffer.from("A1"));
    const pending = await a.tusCreate({ filename: "p.txt", parentId: aRoot.id }, 10);
    const location = pending.get("Location") ?? "";

    const ghost = `/api/uploads/${crypto.randomUUID()}`;
    const unknown = [
      await b.tusHead(ghost),
      await b.tusPatch(ghost, 0, Buffer.from("steal")),
      await b.tusDelete(ghost),
    ];
    const probes = [
      await b.tusHead(location),
      await b.tusPatch(location, 0, Buffer.from("steal")),
      await b.tusDelete(location),
    ];
    probes.forEach((res, i) => {
      expect(res.status).toBe(404);
      // identical to an upload that never existed: no existence oracle
      expect(res.body).toEqual(unknown[i]?.body);
      expect(res.get("Content-Type")).toBe(unknown[i]?.get("Content-Type"));
      if (i > 0) expect(errorCode(res)).toBe("not_found");
    });

    const intoFolder = await b.tusCreate({ filename: "x.txt", parentId: aRoot.id }, 3);
    expect(intoFolder.status).toBe(404);
    const replaceTheirs = await b.tusCreate(
      { filename: "x.txt", parentId: aRoot.id, replaceId: aFile },
      3,
    );
    expect(replaceTheirs.status).toBe(404);
    const replaceFromOwnFolder = await b.tusCreate(
      { filename: "x.txt", parentId: bRoot.id, replaceId: aFile },
      3,
    );
    expect(replaceFromOwnFolder.status).toBe(404);
    for (const res of [intoFolder, replaceTheirs, replaceFromOwnFolder]) {
      expect(errorCode(res)).toBe("not_found");
    }

    // A's upload is untouched and still completes.
    expect((await a.tusHead(location)).get("Upload-Offset")).toBe("0");
    const done = await a.tusPatch(location, 0, Buffer.from("0123456789"));
    expect(done.status).toBe(204);
    expect((await b.root()).children).toEqual([]);
    expect((await a.folder(aRoot.id)).children.map((c) => c.name)).toEqual(["a.txt", "p.txt"]);
  });

  it("ignores a client-sent ownerId", async () => {
    const h = harness();
    const { a, b, bRoot } = await setup(h);
    const created = await b.tusCreate(
      { filename: "mine.txt", parentId: bRoot.id, ownerId: a.user.id },
      3,
    );
    expect(created.status).toBe(201);
    const location = created.get("Location") ?? "";
    expect((await a.tusHead(location)).status).toBe(404);
    const done = await b.tusPatch(location, 0, Buffer.from("abc"));
    expect(done.status).toBe(204);
    expect((await b.root()).children.map((c) => c.name)).toEqual(["mine.txt"]);
    expect(usageResponse.parse((await b.get("/api/usage")).body).usedBytes).toBe(3);
    expect(usageResponse.parse((await a.get("/api/usage")).body).usedBytes).toBe(0);
    expect(
      h.db
        .select()
        .from(fileVersions)
        .all()
        .map((v) => v.ownerId),
    ).toEqual([b.user.id]);
  });

  it("lets the owner terminate an upload and frees its reservation", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    h.setQuota(a.user.id, 100);
    const created = await a.tusCreate({ filename: "a.bin", parentId: aRoot.id }, 80);
    const location = created.get("Location") ?? "";
    expect((await a.tusCreate({ filename: "b.bin", parentId: aRoot.id }, 80)).status).toBe(413);
    expect((await a.tusDelete(location)).status).toBe(204);
    expect((await a.tusHead(location)).status).toBe(404);
    expect((await a.tusCreate({ filename: "b.bin", parentId: aRoot.id }, 80)).status).toBe(201);
  });
});

describe("tus upload quota", () => {
  it("refuses creation with 413 quota_exceeded when it would not fit", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    h.setQuota(a.user.id, 100);
    const over = await a.tusCreate({ filename: "big.bin", parentId: aRoot.id }, 101);
    expect(over.status).toBe(413);
    expect(over.get("Content-Type")).toMatch(/application\/json/);
    expect(over.body).toEqual({ error: { code: "quota_exceeded" } });
    expect((await a.tusCreate({ filename: "fits.bin", parentId: aRoot.id }, 100)).status).toBe(201);
  });

  it("counts every version and unfinished upload against the quota", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    h.setQuota(a.user.id, 100);
    const fileId = await a.upload(aRoot.id, "v.bin", Buffer.alloc(40));
    await a.upload(aRoot.id, "v.bin", Buffer.alloc(40), fileId);
    expect(usageResponse.parse((await a.get("/api/usage")).body).usedBytes).toBe(80);
    expect(
      (await a.tusCreate({ filename: "v.bin", parentId: aRoot.id, replaceId: fileId }, 21)).status,
    ).toBe(413);

    const reserved = await a.tusCreate({ filename: "w.bin", parentId: aRoot.id }, 15);
    expect(reserved.status).toBe(201);
    // 80 used + 15 in flight: 6 more bytes no longer fit, 5 do.
    expect((await a.tusCreate({ filename: "x.bin", parentId: aRoot.id }, 6)).status).toBe(413);
    expect((await a.tusCreate({ filename: "x.bin", parentId: aRoot.id }, 5)).status).toBe(201);
  });

  it("rechecks authoritatively at completion and leaves no blob behind", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const created = await a.tusCreate({ filename: "late.bin", parentId: aRoot.id }, 50);
    expect(created.status).toBe(201);
    h.setQuota(a.user.id, 10); // an admin lowered the quota while the upload was running
    const done = await a.tusPatch(created.get("Location") ?? "", 0, Buffer.alloc(50));
    expect(done.status).toBe(413);
    expect(done.body).toEqual({ error: { code: "quota_exceeded" } });
    expect((await a.folder(aRoot.id)).children).toEqual([]);
    expect(h.db.select().from(fileVersions).all()).toEqual([]);
    expect(blobsOnDisk(h)).toEqual([]);
    expect(tempEntries(h)).toEqual([]);
  });

  it("drops the blob when the parent was trashed during the upload", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const folder = await a.mkdir(aRoot.id, "doomed");
    const created = await a.tusCreate({ filename: "f.bin", parentId: folder.id }, 5);
    await a.del(`/api/files/${folder.id}`);
    const done = await a.tusPatch(created.get("Location") ?? "", 0, Buffer.alloc(5));
    expect(done.status).toBe(404);
    expect(errorCode(done)).toBe("not_found");
    expect(h.db.select().from(fileVersions).all()).toEqual([]);
    expect(tempEntries(h)).toEqual([]);
    expect(blobsOnDisk(h)).toEqual([]);
  });
});

describe("abandoned uploads", () => {
  it("expires unfinished uploads after 24 hours and releases their reservation", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    h.setQuota(a.user.id, 100);
    const stale = await a.tusCreate({ filename: "stale.bin", parentId: aRoot.id }, 90);
    const fresh = await a.tusCreate({ filename: "fresh.bin", parentId: aRoot.id }, 5);
    const staleId = (stale.get("Location") ?? "").split("/").pop() ?? "";
    const freshId = (fresh.get("Location") ?? "").split("/").pop() ?? "";
    await a.tusPatch(stale.get("Location") ?? "", 0, Buffer.alloc(10));
    expect((await a.tusCreate({ filename: "n.bin", parentId: aRoot.id }, 10)).status).toBe(413);

    const infoPath = join(h.dataDir, "tmp", "uploads", `${staleId}.json`);
    const info = JSON.parse(readFileSync(infoPath, "utf8")) as { creation_date: string };
    info.creation_date = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeFileSync(infoPath, JSON.stringify(info));

    await h.app.cleanUpUploads();
    expect(tempEntries(h).sort()).toEqual([freshId, `${freshId}.json`].sort());
    expect((await a.tusHead(stale.get("Location") ?? "")).status).toBe(404);
    expect((await a.tusCreate({ filename: "n.bin", parentId: aRoot.id }, 10)).status).toBe(201);
  });
});
