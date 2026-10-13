import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { errorResponse, usageResponse } from "@cloud/shared";
import { ORIGIN, binary, harness, type Harness } from "../testing/harness.js";
import { createLink, grantCookie, visitor, type Link } from "../testing/shares.js";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function code(res: { body: unknown }): string {
  return errorResponse.parse(res.body).error.code;
}

async function setup(h: Harness) {
  const a = await h.admin();
  const b = await h.member("b@example.com");
  const aRoot = (await a.root()).folder;
  const inbox = await a.mkdir(aRoot.id, "Inbox");
  const other = await a.mkdir(aRoot.id, "Other");
  const drop = await createLink(a, { fileId: inbox.id, allowUpload: true });
  return { a, b, aRoot, inbox, other, drop };
}

/** Upload through a drop box in one PATCH; returns the new file's ID. */
async function dropUpload(
  h: Harness,
  link: Link,
  name: string,
  bytes: Buffer,
  cookie?: string,
): Promise<string> {
  const v = visitor(h, link, cookie);
  const created = await v.tusCreate({ filename: name }, bytes.length);
  expect(created.status).toBe(201);
  const early = created.get("Cloud-File-Id");
  if (early) return early;
  const done = await v.tusPatch(created.get("Location") ?? "", 0, bytes);
  expect(done.status).toBe(204);
  return done.get("Cloud-File-Id") ?? "";
}

describe("drop box: upload-only", () => {
  it("shows info but never lists, serves or zips anything", async () => {
    const h = harness();
    const { a, inbox, drop } = await setup(h);
    const existing = await a.upload(inbox.id, "already.txt", Buffer.from("owner's file"));
    const v = visitor(h, drop);

    const info = await v.get("");
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({
      name: "Inbox",
      kind: "folder",
      allowUpload: true,
      requiresPassword: false,
      unlocked: true,
      size: null,
      mime: null,
    });
    for (const path of [
      "/folder",
      `/folder?folderId=${inbox.id}`,
      "/content",
      `/files/${existing}/content`,
      "/zip",
      `/zip?folderId=${inbox.id}`,
    ]) {
      const res = await v.get(path);
      expect([res.status, code(res)], path).toEqual([404, "not_found"]);
    }
    // Not even the files visitors uploaded themselves can be read back.
    const mine = await dropUpload(h, drop, "mine.txt", Buffer.from("mine"));
    expect((await v.get(`/files/${mine}/content`)).status).toBe(404);
  });

  it("uploads into the shared folder, whatever parentId the client sends", async () => {
    const h = harness();
    const { a, aRoot, inbox, other, drop } = await setup(h);
    const bytes = randomBytes(150_000);
    const v = visitor(h, drop);

    const created = await v.tusCreate(
      { filename: "photo.png", parentId: other.id, ignored: "x" },
      bytes.length,
    );
    expect(created.status).toBe(201);
    expect(created.get("Location")).toMatch(new RegExp(`^${drop.base}/uploads/${UUID}$`));
    const done = await v.tusPatch(created.get("Location") ?? "", 0, bytes);
    expect(done.status).toBe(204);
    const fileId = done.get("Cloud-File-Id") ?? "";
    expect(fileId).toMatch(new RegExp(`^${UUID}$`));

    const listing = await a.folder(inbox.id);
    expect(listing.children).toHaveLength(1);
    expect(listing.children[0]).toMatchObject({
      id: fileId,
      name: "photo.png",
      size: bytes.length,
      mime: "image/png",
    });
    expect((await a.folder(other.id)).children).toEqual([]);
    expect((await a.folder(aRoot.id)).children.map((c) => c.name).sort()).toEqual([
      "Inbox",
      "Other",
    ]);
    const content = await binary(a.get(`/api/files/${fileId}/content`));
    expect((content.body as Buffer).equals(bytes)).toBe(true);
  });

  it("gives colliding names a suffix and never overwrites", async () => {
    const h = harness();
    const { a, inbox, drop } = await setup(h);
    await a.upload(inbox.id, "report.pdf", Buffer.from("owner"));
    await dropUpload(h, drop, "report.pdf", Buffer.from("one"));
    await dropUpload(h, drop, "report.pdf", Buffer.from("two"));
    await dropUpload(h, drop, "notes", Buffer.from("n1"));
    await dropUpload(h, drop, "notes", Buffer.from("n2"));
    const listing = await a.folder(inbox.id);
    expect(listing.children.map((c) => c.name).sort()).toEqual([
      "notes",
      "notes (1)",
      "report (1).pdf",
      "report (2).pdf",
      "report.pdf",
    ]);
    expect(listing.children.find((c) => c.name === "report.pdf")?.versionCount).toBe(1);
  });

  it("refuses replaceId, bad names and missing names", async () => {
    const h = harness();
    const { a, inbox, drop } = await setup(h);
    const existing = await a.upload(inbox.id, "keep.txt", Buffer.from("original"));
    const v = visitor(h, drop);

    for (const meta of [
      { filename: "keep.txt", replaceId: existing },
      { filename: "x.txt", replaceId: "nonexistent" },
      { filename: "a/b.txt" },
      { filename: ".." },
      {},
    ]) {
      const res = await v.tusCreate(meta, 3);
      expect([res.status, code(res)], JSON.stringify(meta)).toEqual([400, "invalid_request"]);
    }
    const listing = await a.folder(inbox.id);
    expect(listing.children.map((c) => [c.name, c.versionCount])).toEqual([["keep.txt", 1]]);
  });

  it("completes an empty upload at creation", async () => {
    const h = harness();
    const { a, inbox, drop } = await setup(h);
    const created = await visitor(h, drop).tusCreate({ filename: "empty.txt" }, 0);
    expect(created.status).toBe(201);
    expect(created.get("Cloud-File-Id")).toMatch(new RegExp(`^${UUID}$`));
    expect((await a.folder(inbox.id)).children.map((c) => c.name)).toEqual(["empty.txt"]);
  });
});

describe("drop box: quota", () => {
  it("counts toward the owner's quota and answers 413 when it would not fit", async () => {
    const h = harness();
    const { a, drop } = await setup(h);
    h.setQuota(a.user.id, 1000);
    await dropUpload(h, drop, "one.bin", randomBytes(600));
    expect(usageResponse.parse((await a.get("/api/usage")).body).usedBytes).toBe(600);

    const over = await visitor(h, drop).tusCreate({ filename: "two.bin" }, 600);
    expect([over.status, code(over)]).toEqual([413, "quota_exceeded"]);
    expect((await visitor(h, drop).tusCreate({ filename: "fits.bin" }, 400)).status).toBe(201);
  });

  it("shares in-flight accounting with the owner's own uploads", async () => {
    const h = harness();
    const { a, inbox, drop } = await setup(h);
    h.setQuota(a.user.id, 1000);
    const own = await a.tusCreate({ filename: "own.bin", parentId: inbox.id }, 700);
    expect(own.status).toBe(201);
    const blocked = await visitor(h, drop).tusCreate({ filename: "visitor.bin" }, 400);
    expect([blocked.status, code(blocked)]).toEqual([413, "quota_exceeded"]);

    // Terminating the owner's upload frees the reservation.
    expect((await a.tusDelete(own.get("Location") ?? "")).status).toBe(204);
    expect((await visitor(h, drop).tusCreate({ filename: "visitor.bin" }, 400)).status).toBe(201);
  });

  it("charges the owner, not any session: a visitor needs no account and has no quota of their own", async () => {
    const h = harness();
    const { a, b, drop } = await setup(h);
    h.setQuota(b.user.id, 1);
    await dropUpload(h, drop, "free.bin", randomBytes(500));
    expect(usageResponse.parse((await a.get("/api/usage")).body).usedBytes).toBe(500);
    expect(usageResponse.parse((await b.get("/api/usage")).body).usedBytes).toBe(0);
  });
});

describe("drop box: upload ownership", () => {
  async function twoBoxes(h: Harness) {
    const s = await setup(h);
    const second = await createLink(s.a, { fileId: s.other.id, allowUpload: true });
    return { ...s, second };
  }
  const idOf = (location: string) => location.split("/").pop() ?? "";

  it("an upload created via share X cannot be continued via share Y or via /api/uploads", async () => {
    const h = harness();
    const { a, drop, second } = await twoBoxes(h);
    const x = visitor(h, drop);
    const y = visitor(h, second);
    const created = await x.tusCreate({ filename: "a.bin" }, 10);
    expect(created.status).toBe(201);
    const location = created.get("Location") ?? "";
    const id = idOf(location);
    const underY = `${second.base}/uploads/${id}`;
    const underApi = `/api/uploads/${id}`;

    // Under X it is alive.
    const head = await x.tusHead(location);
    expect(head.status).toBe(200);
    expect(head.get("Upload-Offset")).toBe("0");

    // Under Y: invisible and untouchable.
    expect((await y.tusHead(underY)).status).toBe(404);
    const patchY = await y.tusPatch(underY, 0, Buffer.alloc(10));
    expect([patchY.status, code(patchY)]).toEqual([404, "not_found"]);
    expect((await y.tusDelete(underY)).status).toBe(404);

    // Under /api/uploads, even for the owner who made the share.
    expect((await a.tusHead(underApi)).status).toBe(404);
    expect((await a.tusPatch(underApi, 0, Buffer.alloc(10))).status).toBe(404);
    expect((await a.tusDelete(underApi)).status).toBe(404);

    // Nothing of it was consumed: X still finishes it.
    expect((await x.tusHead(location)).get("Upload-Offset")).toBe("0");
    const done = await x.tusPatch(location, 0, Buffer.alloc(10, 1));
    expect(done.status).toBe(204);
  });

  it("an upload created via /api/uploads cannot be continued via a share", async () => {
    const h = harness();
    const { a, inbox, drop } = await twoBoxes(h);
    const own = await a.tusCreate({ filename: "own.bin", parentId: inbox.id }, 10);
    expect(own.status).toBe(201);
    const id = idOf(own.get("Location") ?? "");
    const underShare = `${drop.base}/uploads/${id}`;
    const v = visitor(h, drop);
    expect((await v.tusHead(underShare)).status).toBe(404);
    expect((await v.tusPatch(underShare, 0, Buffer.alloc(10))).status).toBe(404);
    expect((await v.tusDelete(underShare)).status).toBe(404);
    expect((await a.tusPatch(own.get("Location") ?? "", 0, Buffer.alloc(10))).status).toBe(204);
  });

  it("another user's session upload is just as unreachable", async () => {
    const h = harness();
    const { b, bRoot, drop } = await (async () => {
      const s = await setup(h);
      return { ...s, bRoot: (await s.b.root()).folder };
    })();
    const theirs = await b.tusCreate({ filename: "b.bin", parentId: bRoot.id }, 10);
    const id = idOf(theirs.get("Location") ?? "");
    expect((await visitor(h, drop).tusHead(`${drop.base}/uploads/${id}`)).status).toBe(404);
  });

  it("terminates an own upload and rejects malformed upload IDs", async () => {
    const h = harness();
    const { drop } = await setup(h);
    const v = visitor(h, drop);
    const created = await v.tusCreate({ filename: "a.bin" }, 10);
    const location = created.get("Location") ?? "";
    expect((await v.tusDelete(location)).status).toBe(204);
    expect((await v.tusHead(location)).status).toBe(404);
    for (const bad of ["nope", "..", "00000000-0000-4000-8000-000000000000"]) {
      expect((await v.tusHead(`${drop.base}/uploads/${bad}`)).status, bad).toBe(404);
    }
  });
});

describe("drop box: guards", () => {
  it("requires the configured Origin for POST, PATCH and DELETE", async () => {
    const h = harness();
    const { drop } = await setup(h);
    const v = visitor(h, drop);
    for (const origin of [null, "https://evil.example"]) {
      const res = await v.tusCreate({ filename: "a.bin" }, 5, origin);
      expect([res.status, code(res)]).toEqual([403, "origin_rejected"]);
    }
    const created = await v.tusCreate({ filename: "a.bin" }, 5, ORIGIN);
    const location = created.get("Location") ?? "";
    expect((await v.tusPatch(location, 0, Buffer.alloc(5), null)).status).toBe(403);
    expect((await v.tusDelete(location, null)).status).toBe(403);
    expect((await v.tusHead(location)).status).toBe(200);
  });

  it("is 404 on a file share, a plain folder share and for non-tus methods", async () => {
    const h = harness();
    const { a, aRoot, inbox } = await setup(h);
    const file = await a.upload(aRoot.id, "f.txt", Buffer.from("f"));
    const plainFolder = await createLink(a, { fileId: inbox.id });
    const fileLink = await createLink(a, { fileId: file });
    const drop = await createLink(a, { fileId: inbox.id, allowUpload: true });
    for (const link of [plainFolder, fileLink]) {
      const res = await visitor(h, link).tusCreate({ filename: "x.txt" }, 1);
      expect([res.status, code(res)]).toEqual([404, "not_found"]);
    }
    expect((await visitor(h, drop).get("/uploads")).status).toBe(404);
  });

  it("answers the CORS preflight", async () => {
    const h = harness();
    const { drop } = await setup(h);
    const { default: request } = await import("supertest");
    const res = await request(h.app).options(`${drop.base}/uploads`).set("Origin", ORIGIN);
    expect(res.status).toBe(204);
  });

  it("with a password: 401 share_locked until unlocked", async () => {
    const h = harness();
    const { a, inbox } = await setup(h);
    const locked = await createLink(a, {
      fileId: inbox.id,
      allowUpload: true,
      password: "hunter2 hunter2",
    });
    const v = visitor(h, locked);
    const refused = await v.tusCreate({ filename: "a.txt" }, 1);
    expect([refused.status, code(refused)]).toEqual([401, "share_locked"]);
    const info = await v.get("");
    expect(info.body).toMatchObject({ allowUpload: true, requiresPassword: true, unlocked: false });

    const cookie = grantCookie(await v.unlock("hunter2 hunter2"));
    await dropUpload(h, locked, "a.txt", Buffer.from("a"), cookie);
    expect((await a.folder(inbox.id)).children.map((c) => c.name)).toEqual(["a.txt"]);
    // A grant for another share does not open this one.
    const second = await createLink(a, {
      fileId: inbox.id,
      allowUpload: true,
      password: "hunter2 hunter2",
    });
    const wrong = await visitor(h, second, cookie).tusCreate({ filename: "b.txt" }, 1);
    expect(wrong.status).toBe(401);
  });

  it("stops working when revoked, expired or trashed, and resumes after a restore", async () => {
    const h = harness();
    const { a, inbox } = await setup(h);
    const day = 24 * 60 * 60 * 1000;
    const short = await createLink(a, { fileId: inbox.id, allowUpload: true, expiresInDays: 1 });
    const revocable = await createLink(a, { fileId: inbox.id, allowUpload: true });
    const durable = await createLink(a, {
      fileId: inbox.id,
      allowUpload: true,
      expiresInDays: null,
    });

    // An upload in progress under a link that then dies cannot continue.
    const pending = await visitor(h, revocable).tusCreate({ filename: "p.bin" }, 4);
    const location = pending.get("Location") ?? "";
    await a.del(`/api/shares/${revocable.id}`);
    expect((await visitor(h, revocable).tusPatch(location, 0, Buffer.alloc(4))).status).toBe(404);
    expect((await visitor(h, revocable).tusHead(location)).status).toBe(404);

    h.clock.t += day;
    expect((await visitor(h, short).tusCreate({ filename: "late.bin" }, 1)).status).toBe(404);

    await a.del(`/api/files/${inbox.id}`);
    expect((await visitor(h, durable).tusCreate({ filename: "x.bin" }, 1)).status).toBe(404);
    await a.post(`/api/trash/${inbox.id}/restore`);
    expect((await visitor(h, durable).tusCreate({ filename: "x.bin" }, 1)).status).toBe(201);
  });
});
