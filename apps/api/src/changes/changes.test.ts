import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  changesPage,
  createdAppPasswordResponse,
  errorResponse,
  fileNode,
  versionListing,
  type Change,
  type ChangesPage,
  type FileNode,
} from "@cloud/shared";
import { changes, files } from "../db/schema/index.js";
import { purgeExpiredTrash } from "../files/trash.js";
import { PASSWORD, harness, type Harness } from "../testing/harness.js";
import { createLink, visitor } from "../testing/shares.js";

const DAY = 24 * 60 * 60 * 1000;
type Session = Awaited<ReturnType<Harness["admin"]>>;

async function feed(s: Session, cursor?: string, limit?: number): Promise<ChangesPage> {
  const params = new URLSearchParams();
  if (cursor !== undefined) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  const res = await s.get(`/api/changes?${params.toString()}`);
  expect(res.status).toBe(200);
  return changesPage.parse(res.body);
}

/** Everything after `cursor`, page by page, the way a sync client reads it. */
async function drain(s: Session, cursor?: string, limit = 1000) {
  const all: Change[] = [];
  let page = await feed(s, cursor, limit);
  all.push(...page.changes);
  while (page.hasMore) {
    page = await feed(s, page.cursor, limit);
    all.push(...page.changes);
  }
  return { changes: all, cursor: page.cursor };
}

/** The feed up to now; the cursor to read only what happens next. */
async function mark(s: Session): Promise<string> {
  return (await drain(s)).cursor;
}

function upserts(list: Change[]): FileNode[] {
  return list.flatMap((c) => (c.type === "upsert" ? [c.node] : []));
}

function deletes(list: Change[]): string[] {
  return list.flatMap((c) => (c.type === "delete" ? [c.id] : []));
}

function code(res: { body: unknown }): string {
  return errorResponse.parse(res.body).error.code;
}

async function setup() {
  const h = harness();
  const a = await h.admin();
  const root = (await a.root()).folder;
  return { h, a, root };
}

describe("change feed: what each write path appends", () => {
  it("lists the root first, with a null parent, even before the root was ever loaded", async () => {
    const h = harness();
    const a = await h.admin();
    const page = await feed(a);
    expect(page.hasMore).toBe(false);
    expect(page.changes).toHaveLength(1);
    const [only] = upserts(page.changes);
    expect(only).toMatchObject({ parentId: null, kind: "folder", name: "" });
    expect((await a.root()).folder.id).toBe(only?.id);
    // Asking again must not mint a second root entry.
    expect(await feed(a)).toEqual(page);
  });

  it("folder create", async () => {
    const { a, root } = await setup();
    const cursor = await mark(a);
    const dir = await a.mkdir(root.id, "Docs");
    const next = await drain(a, cursor);
    expect(next.changes).toEqual([{ type: "upsert", node: dir }]);
  });

  it("upload commit: a new file, then a new version of it", async () => {
    const { a, root } = await setup();
    const cursor = await mark(a);
    const id = await a.upload(root.id, "a.txt", Buffer.from("one"));
    const created = await drain(a, cursor);
    expect(upserts(created.changes)).toMatchObject([
      { id, name: "a.txt", size: 3, versionCount: 1, parentId: root.id },
    ]);

    await a.upload(root.id, "a.txt", Buffer.from("three!"), id);
    const replaced = await drain(a, created.cursor);
    expect(upserts(replaced.changes)).toMatchObject([{ id, size: 6, versionCount: 2 }]);
  });

  it("rename and move", async () => {
    const { a, root } = await setup();
    const dir = await a.mkdir(root.id, "Dir");
    const id = await a.upload(root.id, "a.txt", Buffer.from("x"));
    const cursor = await mark(a);

    expect((await a.patch(`/api/files/${id}`, { name: "b.txt" })).status).toBe(200);
    const renamed = await drain(a, cursor);
    expect(upserts(renamed.changes)).toMatchObject([{ id, name: "b.txt", parentId: root.id }]);

    expect((await a.patch(`/api/files/${id}`, { parentId: dir.id })).status).toBe(200);
    const moved = await drain(a, renamed.cursor);
    expect(upserts(moved.changes)).toMatchObject([{ id, name: "b.txt", parentId: dir.id }]);
  });

  it("a rename that changes nothing, or fails, appends nothing", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "a.txt", Buffer.from("x"));
    await a.upload(root.id, "b.txt", Buffer.from("y"));
    const cursor = await mark(a);
    expect((await a.patch(`/api/files/${id}`, { name: "a.txt" })).status).toBe(200);
    expect((await a.patch(`/api/files/${id}`, { name: "b.txt" })).status).toBe(409);
    expect(await feed(a, cursor)).toEqual({ changes: [], cursor, hasMore: false });
  });

  it("trash: the item and every descendant become deletes", async () => {
    const { a, root } = await setup();
    const top = await a.mkdir(root.id, "Top");
    const sub = await a.mkdir(top.id, "Sub");
    const f1 = await a.upload(top.id, "one.txt", Buffer.from("1"));
    const f2 = await a.upload(sub.id, "two.txt", Buffer.from("2"));
    const bystander = await a.upload(root.id, "stay.txt", Buffer.from("s"));
    const cursor = await mark(a);

    expect((await a.del(`/api/files/${top.id}`)).status).toBe(204);
    const next = await drain(a, cursor);
    expect(next.changes.every((c) => c.type === "delete")).toBe(true);
    expect(deletes(next.changes).sort()).toEqual([top.id, sub.id, f1, f2].sort());
    expect(deletes(next.changes)).not.toContain(bystander);
  });

  it("restore: the item and every active descendant become upserts again", async () => {
    const { a, root } = await setup();
    const top = await a.mkdir(root.id, "Top");
    const sub = await a.mkdir(top.id, "Sub");
    const f2 = await a.upload(sub.id, "two.txt", Buffer.from("2"));
    const earlier = await a.upload(top.id, "gone.txt", Buffer.from("g"));
    expect((await a.del(`/api/files/${earlier}`)).status).toBe(204);
    expect((await a.del(`/api/files/${top.id}`)).status).toBe(204);
    const cursor = await mark(a);

    expect((await a.post(`/api/trash/${top.id}/restore`)).status).toBe(200);
    const next = await drain(a, cursor);
    // Parents come before their children.
    expect(upserts(next.changes).map((n) => n.id)).toEqual([top.id, sub.id, f2]);
    expect(deletes(next.changes)).toEqual([]);
    // A file trashed on its own stays out of a fresh client's snapshot.
    const fresh = await drain(a);
    expect(upserts(fresh.changes).map((n) => n.id)).not.toContain(earlier);
  });

  it("restore of an item whose parent is trashed lands in the root and is reported there", async () => {
    const { a, root } = await setup();
    const parent = await a.mkdir(root.id, "P");
    const child = await a.upload(parent.id, "c.txt", Buffer.from("c"));
    await a.del(`/api/files/${child}`);
    await a.del(`/api/files/${parent.id}`);
    const cursor = await mark(a);
    expect((await a.post(`/api/trash/${child}/restore`)).status).toBe(200);
    const next = await drain(a, cursor);
    expect(upserts(next.changes)).toMatchObject([{ id: child, parentId: root.id }]);
  });

  it("purge of one item and of the whole trash: every purged ID becomes a delete", async () => {
    const { a, root } = await setup();
    const dir = await a.mkdir(root.id, "Dir");
    const inner = await a.upload(dir.id, "in.txt", Buffer.from("i"));
    const lone = await a.upload(root.id, "lone.txt", Buffer.from("l"));
    const other = await a.upload(root.id, "other.txt", Buffer.from("o"));
    await a.del(`/api/files/${dir.id}`);
    await a.del(`/api/files/${lone}`);
    await a.del(`/api/files/${other}`);
    const cursor = await mark(a);

    expect((await a.del(`/api/trash/${dir.id}`)).status).toBe(204);
    const one = await drain(a, cursor);
    expect(one.changes.every((c) => c.type === "delete")).toBe(true);
    expect(deletes(one.changes).sort()).toEqual([dir.id, inner].sort());

    expect((await a.del("/api/trash")).status).toBe(204);
    const all = await drain(a, one.cursor);
    expect(all.changes.every((c) => c.type === "delete")).toBe(true);
    expect(deletes(all.changes).sort()).toEqual([lone, other].sort());
  });

  it("retention sweep purges are deletes", async () => {
    const { h, a, root } = await setup();
    const old = await a.upload(root.id, "old.txt", Buffer.from("o"));
    h.clock.t -= 31 * DAY;
    await a.del(`/api/files/${old}`);
    h.clock.t += 31 * DAY;
    const cursor = await mark(a);
    expect(await purgeExpiredTrash({ db: h.db, dataDir: h.dataDir, now: () => h.clock.t })).toBe(1);
    const next = await drain(a, cursor);
    expect(next.changes).toEqual([{ type: "delete", id: old }]);
  });

  it("version restore and version delete report the file's new state", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "v.txt", Buffer.from("first"));
    await a.upload(root.id, "v.txt", Buffer.from("second!!"), id);
    const { versions } = versionListing.parse((await a.get(`/api/files/${id}/versions`)).body);
    const old = versions.find((v) => !v.current);
    const current = versions.find((v) => v.current);
    if (!old || !current) throw new Error("expected a current and an older version");
    const cursor = await mark(a);

    expect((await a.post(`/api/files/${id}/versions/${old.id}/restore`)).status).toBe(200);
    const restored = await drain(a, cursor);
    expect(upserts(restored.changes)).toMatchObject([
      { id, currentVersionId: old.id, size: old.size, versionCount: 2 },
    ]);

    expect((await a.del(`/api/files/${id}/versions/${current.id}`)).status).toBe(204);
    const trimmed = await drain(a, restored.cursor);
    expect(upserts(trimmed.changes)).toMatchObject([{ id, versionCount: 1 }]);
  });

  it("drop-box uploads land in the owner's feed", async () => {
    const { h, a, root } = await setup();
    const inbox = await a.mkdir(root.id, "Inbox");
    const link = await createLink(a, { fileId: inbox.id, allowUpload: true });
    const cursor = await mark(a);

    const v = visitor(h, link);
    const bytes = Buffer.from("from a visitor");
    const created = await v.tusCreate({ filename: "hello.txt" }, bytes.length);
    expect(created.status).toBe(201);
    const done = await v.tusPatch(created.get("Location") ?? "", 0, bytes);
    expect(done.status).toBe(204);
    const fileId = done.get("Cloud-File-Id");

    const next = await drain(a, cursor);
    expect(upserts(next.changes)).toMatchObject([
      { id: fileId, name: "hello.txt", parentId: inbox.id, size: bytes.length },
    ]);
  });

  it("sharing and albums do not touch files, so they append nothing", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "s.txt", Buffer.from("s"));
    const cursor = await mark(a);
    const link = await createLink(a, { fileId: id });
    expect((await a.del(`/api/shares/${link.id}`)).status).toBe(204);
    expect((await a.post("/api/albums", { name: "Trip" })).status).toBe(201);
    expect(await feed(a, cursor)).toEqual({ changes: [], cursor, hasMore: false });
  });
});

describe("change feed: reading", () => {
  it("reports only the latest state of an item (rename twice → one entry)", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "a.txt", Buffer.from("x"));
    const cursor = await mark(a);
    await a.patch(`/api/files/${id}`, { name: "b.txt" });
    await a.patch(`/api/files/${id}`, { name: "c.txt" });
    const next = await drain(a, cursor);
    expect(next.changes).toHaveLength(1);
    expect(upserts(next.changes)).toMatchObject([{ id, name: "c.txt" }]);
    // From the start too: the item appears once, under its final name.
    const snapshot = upserts((await drain(a)).changes).filter((n) => n.id === id);
    expect(snapshot).toMatchObject([{ name: "c.txt" }]);
  });

  it("an item changed and then trashed is a single delete", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "a.txt", Buffer.from("x"));
    const cursor = await mark(a);
    await a.patch(`/api/files/${id}`, { name: "b.txt" });
    await a.del(`/api/files/${id}`);
    expect((await drain(a, cursor)).changes).toEqual([{ type: "delete", id }]);
  });

  it("without a cursor it is a snapshot of active items: no deletes, trashed and purged omitted", async () => {
    const { a, root } = await setup();
    const keep = await a.upload(root.id, "keep.txt", Buffer.from("k"));
    const trashed = await a.upload(root.id, "trashed.txt", Buffer.from("t"));
    const purged = await a.upload(root.id, "purged.txt", Buffer.from("p"));
    await a.del(`/api/files/${trashed}`);
    await a.del(`/api/files/${purged}`);
    await a.del(`/api/trash/${purged}`);

    const page = await feed(a);
    expect(page.changes.every((c) => c.type === "upsert")).toBe(true);
    expect(
      upserts(page.changes)
        .map((n) => n.id)
        .sort(),
    ).toEqual([root.id, keep].sort());
    expect(page.hasMore).toBe(false);
  });

  it("paginates with limit and hasMore without losing or repeating an item", async () => {
    const { a, root } = await setup();
    const ids = [root.id];
    for (let i = 0; i < 7; i++) {
      ids.push((await a.mkdir(root.id, `d${i}`)).id);
    }
    // Touch some twice so the page boundaries do not line up with the creation order.
    await a.patch(`/api/files/${ids[2]}`, { name: "renamed" });
    await a.patch(`/api/files/${ids[5]}`, { name: "renamed too" });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await feed(a, cursor, 3);
      pages++;
      expect(page.changes.length).toBeLessThanOrEqual(3);
      seen.push(...upserts(page.changes).map((n) => n.id));
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(ids.length);
    expect(new Set(seen)).toEqual(new Set(ids));

    // A change made after the last page is picked up by the next read, not lost.
    const late = await a.mkdir(root.id, "late");
    expect(upserts((await drain(a, cursor, 3)).changes).map((n) => n.id)).toEqual([late.id]);
  });

  it("with nothing new it returns the same cursor and hasMore false", async () => {
    const { a } = await setup();
    const cursor = await mark(a);
    expect(await feed(a, cursor)).toEqual({ changes: [], cursor, hasMore: false });
  });

  it("is scoped to the user: B never sees A's changes", async () => {
    const { h, a, root } = await setup();
    const b = await h.member("b@example.com");
    const bRoot = (await b.root()).folder;
    const secret = await a.upload(root.id, "secret.txt", Buffer.from("s"));
    await a.del(`/api/files/${secret}`);
    const mine = await b.mkdir(bRoot.id, "mine");

    const seenByB = (await drain(b)).changes;
    expect(upserts(seenByB).map((n) => n.id)).toEqual([bRoot.id, mine.id]);
    expect(JSON.stringify(seenByB)).not.toContain(secret);
    expect(JSON.stringify(seenByB)).not.toContain("secret.txt");
    // Not even deletes of A's items leak through a cursor taken from A's feed.
    const fromA = await drain(b, await mark(a));
    expect(deletes(fromA.changes)).toEqual([]);
    expect(upserts(fromA.changes).every((n) => [bRoot.id, mine.id].includes(n.id))).toBe(true);
  });

  it("requires authentication", async () => {
    const { h } = await setup();
    const res = await request(h.app).get("/api/changes");
    expect(res.status).toBe(401);
    expect(code(res)).toBe("unauthenticated");
  });

  it("an app password (Bearer) can read the feed", async () => {
    const { h, a, root } = await setup();
    const dir = await a.mkdir(root.id, "Docs");
    const created = await a.post("/api/auth/app-passwords", { name: "cli", password: PASSWORD });
    expect(created.status).toBe(201);
    const { token } = createdAppPasswordResponse.parse(created.body);

    const res = await request(h.app).get("/api/changes").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = upserts(changesPage.parse(res.body).changes).map((n) => n.id);
    expect(ids).toEqual([root.id, dir.id]);
    const bad = await request(h.app).get("/api/changes").set("Authorization", "Bearer nope");
    expect(bad.status).toBe(401);
  });

  it("rejects malformed, forged and unknown cursors and out-of-range limits with 400", async () => {
    const { a } = await setup();
    const real = await mark(a);
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const bad = [
      "garbage",
      "not base64 !!",
      Buffer.from("not json").toString("base64url"),
      b64({ v: 1 }),
      b64({ v: 2, s: 1 }),
      b64({ v: 1, s: -1 }),
      b64({ v: 1, s: 1.5 }),
      b64({ v: 1, s: "1" }),
      b64({ v: 1, s: 1, extra: true }),
      b64([1, 1]),
      b64(null),
      `${real}=`,
      `${real}A`,
      b64({ v: 1, s: 999_999 }), // beyond anything this server issued
      "a".repeat(201),
    ];
    for (const cursor of bad) {
      const res = await a.get(`/api/changes?cursor=${encodeURIComponent(cursor)}`);
      expect([cursor.slice(0, 20), res.status, code(res)]).toEqual([
        cursor.slice(0, 20),
        400,
        "invalid_request",
      ]);
    }
    for (const limit of ["0", "1001", "x", "1.5", "-1"]) {
      const res = await a.get(`/api/changes?limit=${limit}`);
      expect([limit, res.status]).toEqual([limit, 400]);
    }
    expect((await a.get("/api/changes?limit=1000")).status).toBe(200);
  });

  it("an empty cursor value is rejected rather than treated as 'no cursor'", async () => {
    const { a } = await setup();
    expect((await a.get("/api/changes?cursor=")).status).toBe(400);
  });

  it("serialises items exactly like the files API", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "a.txt", Buffer.from("hello"));
    const listed = (await a.folder(root.id)).children.find((c) => c.id === id);
    const fromFeed = upserts((await drain(a)).changes).find((n) => n.id === id);
    expect(fileNode.parse(fromFeed)).toEqual(listed);
  });
});

describe("change feed: atomic with the mutation", () => {
  it("a mutation that fails after its change row was appended leaves neither behind", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "a.txt", Buffer.from("x"));
    const before = h.db.select().from(changes).all().length;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The activity insert comes last in the trash transaction; make it fail.
    h.db.run(sql`drop table activity`);
    expect((await a.del(`/api/files/${id}`)).status).toBe(500);
    quiet.mockRestore();
    expect(h.db.select().from(changes).all()).toHaveLength(before);
    expect(h.db.select().from(files).where(eq(files.id, id)).get()?.deletedAt).toBeNull();
  });
});

describe("change feed: migration backfill", () => {
  it("gives every file that existed before the feed one row, so a new client sees everything", async () => {
    const { h, a, root } = await setup();
    const dir = await a.mkdir(root.id, "Dir");
    const f = await a.upload(dir.id, "a.txt", Buffer.from("a"));
    const gone = await a.upload(root.id, "gone.txt", Buffer.from("g"));
    await a.del(`/api/files/${gone}`);
    const b = await h.member("b@example.com");
    const bRoot = (await b.root()).folder;

    // An existing install: files, no change rows.
    h.db.delete(changes).run();
    expect(h.db.select().from(changes).all()).toEqual([]);
    const backfill = readFileSync(
      fileURLToPath(new URL("../../drizzle/0007_changes_backfill.sql", import.meta.url)),
      "utf8",
    );
    h.db.run(sql.raw(backfill));

    const everyFile = h.db.select({ id: files.id, ownerId: files.ownerId }).from(files).all();
    const rows = h.db.select().from(changes).all();
    expect(rows.map((r) => r.fileId).sort()).toEqual(everyFile.map((r) => r.id).sort());
    for (const row of rows) {
      expect(row.ownerId).toBe(everyFile.find((x) => x.id === row.fileId)?.ownerId);
    }

    const sync = await drain(a);
    expect(
      upserts(sync.changes)
        .map((n) => n.id)
        .sort(),
    ).toEqual([root.id, dir.id, f].sort());
    expect(deletes(sync.changes)).toEqual([]);
    expect(upserts((await drain(b)).changes).map((n) => n.id)).toEqual([bRoot.id]);
    // And the feed keeps working on top of the backfilled rows.
    const newer = await a.mkdir(root.id, "New");
    expect(upserts((await drain(a, sync.cursor)).changes).map((n) => n.id)).toEqual([newer.id]);
  });

  it("a fresh database has the changes table with its owner/seq index", () => {
    const h = harness();
    const idx = h.db.all<{ name: string }>(sql`pragma index_list('changes')`).map((r) => r.name);
    expect(idx).toContain("changes_owner_seq_idx");
  });
});
