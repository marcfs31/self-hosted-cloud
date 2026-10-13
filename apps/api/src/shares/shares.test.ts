import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createdShareResponse,
  errorResponse,
  listSharesResponse,
  publicShareInfo,
} from "@cloud/shared";
import { shares } from "../db/schema/index.js";
import { ORIGIN, harness, type Harness } from "../testing/harness.js";
import { createLink, grantCookie, visitor, type Link } from "../testing/shares.js";

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "open sesame please";

function code(res: { body: unknown }): string {
  return errorResponse.parse(res.body).error.code;
}

async function setup(h: Harness) {
  const a = await h.admin();
  const b = await h.member("b@example.com");
  const aRoot = (await a.root()).folder;
  const bRoot = (await b.root()).folder;
  return { a, b, aRoot, bRoot };
}

/** Every public endpoint answers 404 not_found for this link. */
async function expectGone(h: Harness, link: Link, someId: string): Promise<void> {
  const v = visitor(h, link);
  const gets = [
    "",
    "/content",
    "/folder",
    `/folder?folderId=${someId}`,
    `/files/${someId}/content`,
    "/zip",
  ];
  for (const path of gets) {
    const res = await v.get(path);
    expect(res.status, path).toBe(404);
    expect(code(res), path).toBe("not_found");
  }
  const unlock = await v.unlock("some password");
  expect(unlock.status).toBe(404);
  const upload = await v.tusCreate({ filename: "x.txt" }, 1);
  expect(upload.status).toBe(404);
  expect(code(upload)).toBe("not_found");
}

describe("owner endpoints", () => {
  it("creates, lists and revokes a share; the token is shown once and never stored", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const fileId = await a.upload(aRoot.id, "report.pdf", Buffer.from("%PDF-1.4"));

    const created = await a.post("/api/shares", { fileId });
    expect(created.status).toBe(201);
    const { share, token } = created.body as { share: Record<string, unknown>; token: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(share).toMatchObject({
      fileId,
      fileName: "report.pdf",
      kind: "file",
      allowUpload: false,
      hasPassword: false,
    });
    expect(JSON.stringify(share)).not.toContain(token);
    expect(Date.parse(share.expiresAt as string)).toBe(h.clock.t + 7 * DAY);

    const rows = h.db.select().from(shares).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(rows)).not.toContain(token);

    const listed = listSharesResponse.parse((await a.get("/api/shares")).body);
    expect(listed.shares.map((s) => s.id)).toEqual([share.id]);
    expect(JSON.stringify(listed)).not.toContain(token);

    const revoked = await a.del(`/api/shares/${String(share.id)}`);
    expect(revoked.status).toBe(204);
    expect(listSharesResponse.parse((await a.get("/api/shares")).body).shares).toEqual([]);
    expect((await a.del(`/api/shares/${String(share.id)}`)).status).toBe(404);
  });

  it("lists newest first with the file name and kind, and honours expiry and password options", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const folder = await a.mkdir(aRoot.id, "Photos");
    const fileId = await a.upload(aRoot.id, "a.txt", Buffer.from("a"));
    const first = await a.post("/api/shares", { fileId, expiresInDays: null });
    h.clock.t += 1000;
    const second = await a.post("/api/shares", {
      fileId: folder.id,
      expiresInDays: 30,
      password: PASSWORD,
    });
    const firstShare = createdShareResponse.parse(first.body).share;
    const secondShare = createdShareResponse.parse(second.body).share;
    expect(firstShare.expiresAt).toBeNull();
    expect(Date.parse(secondShare.expiresAt ?? "")).toBe(h.clock.t + 30 * DAY);
    expect(secondShare.hasPassword).toBe(true);

    const rows = listSharesResponse.parse((await a.get("/api/shares")).body).shares;
    expect(rows.map((s) => [s.fileName, s.kind])).toEqual([
      ["Photos", "folder"],
      ["a.txt", "file"],
    ]);
    const stored = h.db.select().from(shares).all();
    const withPassword = stored.find((s) => s.passwordHash !== null);
    expect(withPassword?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
  });

  it("refuses the root, upload links on files, bad options and unauthenticated callers", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const fileId = await a.upload(aRoot.id, "a.txt", Buffer.from("a"));
    const folder = await a.mkdir(aRoot.id, "Inbox");

    const root = await a.post("/api/shares", { fileId: aRoot.id });
    expect([root.status, code(root)]).toEqual([409, "invalid_move"]);
    const dropFile = await a.post("/api/shares", { fileId, allowUpload: true });
    expect([dropFile.status, code(dropFile)]).toEqual([400, "invalid_request"]);
    expect((await a.post("/api/shares", { fileId: folder.id, allowUpload: true })).status).toBe(
      201,
    );
    for (const bad of [
      { fileId, password: "short" },
      { fileId, expiresInDays: 0 },
      { fileId, expiresInDays: 366 },
      { fileId, expiresInDays: 1.5 },
      {},
    ]) {
      expect((await a.post("/api/shares", bad)).status).toBe(400);
    }
    expect((await request(h.app).get("/api/shares")).status).toBe(401);
    const noOrigin = await request(h.app)
      .post("/api/shares")
      .set("Cookie", a.cookie)
      .send({ fileId });
    expect(noOrigin.status).toBe(403);
  });

  it("scopes shares to their owner: user B gets 404 on A's items and share IDs", async () => {
    const h = harness();
    const { a, b, aRoot, bRoot } = await setup(h);
    const aFile = await a.upload(aRoot.id, "secret.txt", Buffer.from("secret"));
    const bFile = await b.upload(bRoot.id, "mine.txt", Buffer.from("mine"));
    const aLink = await createLink(a, { fileId: aFile });

    // B cannot share A's file, whether it exists or not.
    for (const fileId of [aFile, "00000000-0000-4000-8000-000000000000"]) {
      const res = await b.post("/api/shares", { fileId });
      expect([res.status, code(res)]).toEqual([404, "not_found"]);
    }
    // B cannot revoke A's share, and A's share is not in B's list.
    const del = await b.del(`/api/shares/${aLink.id}`);
    expect([del.status, code(del)]).toEqual([404, "not_found"]);
    const bLink = await createLink(b, { fileId: bFile });
    expect(
      listSharesResponse.parse((await b.get("/api/shares")).body).shares.map((s) => s.id),
    ).toEqual([bLink.id]);
    // A's link survived B's attempt.
    expect((await visitor(h, aLink).get("")).status).toBe(200);
    // And A cannot touch B's.
    expect((await a.del(`/api/shares/${bLink.id}`)).status).toBe(404);
  });

  it("refuses a trashed target", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const folder = await a.mkdir(aRoot.id, "Old");
    const inner = await a.upload(folder.id, "in.txt", Buffer.from("x"));
    await a.del(`/api/files/${folder.id}`);
    for (const fileId of [folder.id, inner]) {
      expect((await a.post("/api/shares", { fileId })).status).toBe(404);
    }
  });
});

describe("public file share", () => {
  it("serves info and content with the safe headers, and ?download=1 forces attachment", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const bytes = Buffer.from("hello shared world");
    const fileId = await a.upload(aRoot.id, "note.txt", bytes);
    const link = await createLink(a, { fileId });
    const v = visitor(h, link);

    const info = await v.get("");
    expect(info.status).toBe(200);
    expect(publicShareInfo.parse(info.body)).toMatchObject({
      name: "note.txt",
      kind: "file",
      allowUpload: false,
      requiresPassword: false,
      unlocked: true,
      size: bytes.length,
      mime: "text/plain",
    });
    expect(Object.keys(info.body as object).sort()).toEqual(
      [
        "allowUpload",
        "expiresAt",
        "kind",
        "mime",
        "name",
        "requiresPassword",
        "size",
        "unlocked",
      ].sort(),
    );
    expect(info.get("Referrer-Policy")).toBe("no-referrer");

    const inline = await v.get("/content");
    expect(inline.status).toBe(200);
    expect(inline.text).toBe(bytes.toString());
    expect(inline.get("Content-Disposition")).toMatch(/^inline/);
    expect(inline.get("X-Content-Type-Options")).toBe("nosniff");
    expect(inline.get("Content-Security-Policy")).toContain("sandbox");
    expect(inline.get("Referrer-Policy")).toBe("no-referrer");

    const download = await v.get("/content?download=1");
    expect(download.get("Content-Disposition")).toMatch(/^attachment/);
    expect(download.get("Content-Type")).toBe("application/octet-stream");

    const ranged = await v.get("/content").set("Range", "bytes=6-11");
    expect(ranged.status).toBe(206);
    expect(ranged.text).toBe("shared");
  });

  it("answers 404 for a folder-only endpoint on a file share", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const fileId = await a.upload(aRoot.id, "a.txt", Buffer.from("a"));
    const v = visitor(h, await createLink(a, { fileId }));
    for (const path of [
      "/folder",
      `/folder?folderId=${fileId}`,
      `/files/${fileId}/content`,
      "/zip",
    ]) {
      expect((await v.get(path)).status, path).toBe(404);
    }
    expect((await v.get("/nope")).status).toBe(404);
  });

  it("an unknown or malformed token is 404 and never reveals anything", async () => {
    const h = harness();
    await setup(h);
    const stranger = { id: "x", token: "nope", base: "/api/public/shares/nope" };
    await expectGone(h, stranger, "id");
    const huge = {
      id: "x",
      token: "a".repeat(5000),
      base: `/api/public/shares/${"a".repeat(5000)}`,
    };
    expect((await visitor(h, huge).get("")).status).toBe(404);
  });
});

describe("lifetime of a link", () => {
  it("expired links are 404 on every public route", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const folder = await a.mkdir(aRoot.id, "Docs");
    const fileId = await a.upload(folder.id, "a.txt", Buffer.from("a"));
    const fileLink = await createLink(a, { fileId, expiresInDays: 1 });
    const folderLink = await createLink(a, { fileId: folder.id, expiresInDays: 1 });
    const dropLink = await createLink(a, {
      fileId: folder.id,
      expiresInDays: 1,
      allowUpload: true,
    });
    const forever = await createLink(a, { fileId, expiresInDays: null });

    expect((await visitor(h, fileLink).get("/content")).status).toBe(200);
    h.clock.t += DAY - 1;
    expect((await visitor(h, fileLink).get("/content")).status).toBe(200);
    h.clock.t += 1;
    for (const link of [fileLink, folderLink, dropLink]) await expectGone(h, link, fileId);
    // Expired links stay listed for the owner (to revoke) and a link without expiry lives on.
    expect(listSharesResponse.parse((await a.get("/api/shares")).body).shares).toHaveLength(4);
    expect((await visitor(h, forever).get("/content")).status).toBe(200);
  });

  it("revoked links are 404 on every public route", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const folder = await a.mkdir(aRoot.id, "Docs");
    const fileId = await a.upload(folder.id, "a.txt", Buffer.from("a"));
    const fileLink = await createLink(a, { fileId });
    const folderLink = await createLink(a, { fileId: folder.id });
    const dropLink = await createLink(a, { fileId: folder.id, allowUpload: true });
    const other = await createLink(a, { fileId: folder.id });
    for (const link of [fileLink, folderLink, dropLink]) {
      expect((await a.del(`/api/shares/${link.id}`)).status).toBe(204);
      await expectGone(h, link, fileId);
    }
    expect((await visitor(h, other).get("")).status).toBe(200);
  });

  it("a trashed target is 404 and the link works again once restored", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const folder = await a.mkdir(aRoot.id, "Docs");
    const inner = await a.mkdir(folder.id, "Inner");
    const fileId = await a.upload(inner.id, "a.txt", Buffer.from("a"));
    const links = {
      file: await createLink(a, { fileId }),
      folder: await createLink(a, { fileId: folder.id }),
      drop: await createLink(a, { fileId: inner.id, allowUpload: true }),
    };

    // Trashing the folder takes the file (ancestor trashed) and the drop box down with it.
    expect((await a.del(`/api/files/${folder.id}`)).status).toBe(204);
    for (const link of Object.values(links)) await expectGone(h, link, fileId);

    const restored = await a.post(`/api/trash/${folder.id}/restore`);
    expect(restored.status).toBe(200);
    expect((await visitor(h, links.file).get("/content")).text).toBe("a");
    expect((await visitor(h, links.folder).get("")).status).toBe(200);
    expect((await visitor(h, links.drop).get("")).status).toBe(200);

    // The file itself trashed and restored, too.
    await a.del(`/api/files/${fileId}`);
    expect((await visitor(h, links.file).get("")).status).toBe(404);
    await a.post(`/api/trash/${fileId}/restore`);
    expect((await visitor(h, links.file).get("")).status).toBe(200);
  });

  it("an expired or revoked link does not come back with a restore", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const fileId = await a.upload(aRoot.id, "a.txt", Buffer.from("a"));
    const link = await createLink(a, { fileId, expiresInDays: 1 });
    const revoked = await createLink(a, { fileId });
    await a.del(`/api/shares/${revoked.id}`);
    await a.del(`/api/files/${fileId}`);
    h.clock.t += 2 * DAY;
    await a.post(`/api/trash/${fileId}/restore`);
    expect((await visitor(h, link).get("")).status).toBe(404);
    expect((await visitor(h, revoked).get("")).status).toBe(404);
  });

  it("purging the item deletes its shares", async () => {
    const h = harness();
    const { a, aRoot } = await setup(h);
    const fileId = await a.upload(aRoot.id, "a.txt", Buffer.from("a"));
    const link = await createLink(a, { fileId });
    await a.del(`/api/files/${fileId}`);
    expect((await a.del(`/api/trash/${fileId}`)).status).toBe(204);
    expect(h.db.select().from(shares).all()).toHaveLength(0);
    expect((await visitor(h, link).get("")).status).toBe(404);
  });
});

describe("password protection", () => {
  async function protectedFile(h: Harness) {
    const { a, aRoot } = await setup(h);
    const fileId = await a.upload(aRoot.id, "private.txt", Buffer.from("top secret"));
    const link = await createLink(a, { fileId, password: PASSWORD });
    return { a, aRoot, fileId, link };
  }

  it("is locked until unlocked: info says so, everything else is 401 share_locked", async () => {
    const h = harness();
    const { link } = await protectedFile(h);
    const v = visitor(h, link);

    const info = await v.get("");
    expect(info.status).toBe(200);
    expect(publicShareInfo.parse(info.body)).toMatchObject({
      requiresPassword: true,
      unlocked: false,
      kind: "file",
      name: "",
      size: null,
      mime: null,
    });
    const content = await v.get("/content");
    expect([content.status, code(content)]).toEqual([401, "share_locked"]);
    expect(content.text).not.toContain("top secret");
  });

  it("rejects a wrong password, then unlocks with the right one and sets a scoped HttpOnly cookie", async () => {
    const h = harness();
    const { link } = await protectedFile(h);
    const v = visitor(h, link);

    const wrong = await v.unlock("not the password");
    expect([wrong.status, code(wrong)]).toEqual([401, "invalid_credentials"]);
    expect(wrong.get("Set-Cookie")).toBeUndefined();

    const ok = await v.unlock(PASSWORD);
    expect(ok.status).toBe(204);
    const header = (ok.get("Set-Cookie") ?? [])[0] ?? "";
    expect(header).toMatch(new RegExp(`^sg_${link.id}=[A-Za-z0-9_-]{43};`));
    expect(header).toContain(`Path=${link.base}`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=3600");
    expect(header).not.toContain("Secure"); // development; Secure is set in production

    const cookie = grantCookie(ok);
    const unlocked = visitor(h, link, cookie);
    expect(publicShareInfo.parse((await unlocked.get("")).body)).toMatchObject({
      unlocked: true,
      name: "private.txt",
      size: 10,
    });
    const content = await unlocked.get("/content");
    expect(content.status).toBe(200);
    expect(content.text).toBe("top secret");
  });

  it("rate-limits unlock attempts per IP and share: the 6th attempt is 429", async () => {
    const h = harness();
    const { a, aRoot, link } = await protectedFile(h);
    const v = visitor(h, link);
    for (let n = 0; n < 5; n++) expect((await v.unlock(`wrong-${n}`)).status).toBe(401);
    const sixth = await v.unlock(PASSWORD);
    expect([sixth.status, code(sixth)]).toEqual([429, "too_many_attempts"]);

    // Another share is not affected, and the window passes.
    const otherFile = await a.upload(aRoot.id, "other.txt", Buffer.from("o"));
    const other = await createLink(a, { fileId: otherFile, password: PASSWORD });
    expect((await visitor(h, other).unlock(PASSWORD)).status).toBe(204);
    h.clock.t += 16 * 60 * 1000;
    expect((await v.unlock(PASSWORD)).status).toBe(204);
  });

  it("a success resets the failure count", async () => {
    const h = harness();
    const { link } = await protectedFile(h);
    const v = visitor(h, link);
    for (let round = 0; round < 3; round++) {
      for (let n = 0; n < 4; n++) expect((await v.unlock("nope-nope")).status).toBe(401);
      expect((await v.unlock(PASSWORD)).status).toBe(204);
    }
  });

  it("a grant for one share is worthless for another", async () => {
    const h = harness();
    const { a, aRoot, link: x } = await protectedFile(h);
    const otherFile = await a.upload(aRoot.id, "other.txt", Buffer.from("other"));
    const y = await createLink(a, { fileId: otherFile, password: PASSWORD });

    const grantX = grantCookie(await visitor(h, x).unlock(PASSWORD));
    expect((await visitor(h, x, grantX).get("/content")).status).toBe(200);

    // X's cookie sent to Y: wrong cookie name.
    const sentToY = await visitor(h, y, grantX).get("/content");
    expect([sentToY.status, code(sentToY)]).toEqual([401, "share_locked"]);
    // X's grant value under Y's cookie name: the grant belongs to X.
    const grantValue = grantX.split("=")[1] ?? "";
    const forged = await visitor(h, y, `sg_${y.id}=${grantValue}`).get("/content");
    expect([forged.status, code(forged)]).toEqual([401, "share_locked"]);
    expect((await visitor(h, y, `sg_${y.id}=garbage`).get("/content")).status).toBe(401);
    expect(publicShareInfo.parse((await visitor(h, y, grantX).get("")).body).unlocked).toBe(false);
  });

  it("a grant lasts one hour and dies with the share", async () => {
    const h = harness();
    const { a, link } = await protectedFile(h);
    const cookie = grantCookie(await visitor(h, link).unlock(PASSWORD));
    h.clock.t += 59 * 60 * 1000;
    expect((await visitor(h, link, cookie).get("/content")).status).toBe(200);
    h.clock.t += 2 * 60 * 1000;
    expect((await visitor(h, link, cookie).get("/content")).status).toBe(401);

    const fresh = grantCookie(await visitor(h, link).unlock(PASSWORD));
    await a.del(`/api/shares/${link.id}`);
    expect((await visitor(h, link, fresh).get("/content")).status).toBe(404);
  });

  it("unlock needs the right Origin, a body, and is a no-op without a password", async () => {
    const h = harness();
    const { a, aRoot, link } = await protectedFile(h);
    const v = visitor(h, link);
    expect((await v.unlock(PASSWORD, null)).status).toBe(403);
    expect((await v.unlock(PASSWORD, "https://evil.example")).status).toBe(403);
    const empty = await request(h.app).post(`${link.base}/unlock`).set("Origin", ORIGIN).send({});
    expect([empty.status, code(empty)]).toEqual([400, "invalid_request"]);

    const plainFile = await a.upload(aRoot.id, "plain.txt", Buffer.from("p"));
    const plain = visitor(h, await createLink(a, { fileId: plainFile }));
    const res = await plain.unlock("anything");
    expect(res.status).toBe(204);
    expect(res.get("Set-Cookie")).toBeUndefined();
  });
});
