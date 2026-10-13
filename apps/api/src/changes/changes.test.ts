import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const cursorV2 = (s: number) => b64({ v: 2, s });
const cursorV1 = (s: number) => b64({ v: 1, s });

/** The position inside the cursor the server returned (its own, per-user sequence). */
function positionOf(cursor: string): number {
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
    v: number;
    s: number;
  };
  expect(parsed.v).toBe(2);
  return parsed.s;
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
    // Not even deletes of A's items show up in B's feed after a cursor.
    const fromStart = await drain(b, await mark(b));
    expect(fromStart.changes).toEqual([]);
    expect(deletes((await drain(b, cursorV2(0))).changes)).toEqual([]);
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
    const bad = [
      "garbage",
      "not base64 !!",
      Buffer.from("not json").toString("base64url"),
      b64({ v: 1 }),
      b64({ v: 3, s: 1 }),
      b64({ v: 2 }),
      b64({ v: 2, s: -1 }),
      b64({ v: 2, s: 1.5 }),
      b64({ v: 2, s: "1" }),
      b64({ v: 2, s: 1, extra: true }),
      b64({ v: 2, s: 999_999 }), // beyond anything issued to this user
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

function ownerSeqs(h: Harness, ownerId: string): number[] {
  return h.db
    .select({ s: changes.ownerSeq })
    .from(changes)
    .where(eq(changes.ownerId, ownerId))
    .orderBy(asc(changes.seq))
    .all()
    .map((r) => r.s);
}

describe("change feed: per-user sequence", () => {
  it("gives each owner its own gap-free 1..n sequence while two users interleave writes", async () => {
    const { h, a, root } = await setup();
    const b = await h.member("b@example.com");
    const bRoot = (await b.root()).folder;

    for (let i = 0; i < 6; i++) {
      await a.mkdir(root.id, `a${i}`);
      await b.mkdir(bRoot.id, `b${i}`);
      if (i % 2 === 0) await a.upload(root.id, `a${i}.txt`, Buffer.from("x"));
    }
    // One operation that records several items at once: a folder with a child, trashed.
    const dir = await a.mkdir(root.id, "bulk");
    await a.upload(dir.id, "in.txt", Buffer.from("1"));
    await a.del(`/api/files/${dir.id}`);

    for (const user of [a.user, b.user]) {
      const seqs = ownerSeqs(h, user.id);
      expect(seqs.length).toBeGreaterThan(6);
      expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    }
    // The global order really interleaved, so the shared counter is neither user's sequence.
    const globalOrder = h.db.select().from(changes).orderBy(asc(changes.seq)).all();
    expect(globalOrder.some((r, i) => i > 0 && r.ownerId !== globalOrder[i - 1]?.ownerId)).toBe(
      true,
    );
    expect(Math.max(...globalOrder.map((r) => r.seq))).toBeGreaterThan(
      ownerSeqs(h, a.user.id).length,
    );
  });

  it("cursors count only the user's own changes: another user's activity never moves them", async () => {
    const { h, a, root } = await setup();
    const b = await h.member("b@example.com");
    const bRoot = (await b.root()).folder;
    await b.mkdir(bRoot.id, "one");
    const before = await mark(b);
    expect(positionOf(before)).toBe(ownerSeqs(h, b.user.id).length);

    // A writes a lot; B's cursor and B's feed do not change at all.
    for (let i = 0; i < 25; i++) await a.upload(root.id, `f${i}.txt`, Buffer.from("x"));
    expect(await feed(b, before)).toEqual({ changes: [], cursor: before, hasMore: false });
    expect(positionOf(await mark(b))).toBe(positionOf(before));
    // A's cursor is A's own count, not the global one (which also includes B's rows).
    const aPosition = positionOf(await mark(a));
    expect(aPosition).toBe(ownerSeqs(h, a.user.id).length);
    expect(h.db.select().from(changes).all().length).toBeGreaterThan(aPosition);
  });

  it("a cursor of a busier user is refused for a quieter one, never interpreted", async () => {
    const { a, root, h } = await setup();
    const b = await h.member("b@example.com");
    for (let i = 0; i < 10; i++) await a.upload(root.id, `f${i}.txt`, Buffer.from("x"));
    await b.root();
    const aCursor = await mark(a);
    expect(positionOf(aCursor)).toBeGreaterThan(10);
    const res = await b.get(`/api/changes?cursor=${encodeURIComponent(aCursor)}`);
    expect([res.status, code(res)]).toEqual([400, "invalid_request"]);
  });

  it("still accepts a v1 cursor (the old global seq) and answers with a v2 one", async () => {
    const { h, a, root } = await setup();
    const b = await h.member("b@example.com");
    const bRoot = (await b.root()).folder;
    const first = await a.mkdir(root.id, "first");
    await b.mkdir(bRoot.id, "interleaved");
    const second = await a.mkdir(root.id, "second");
    const third = await a.mkdir(root.id, "third");

    const row = h.db.select().from(changes).where(eq(changes.fileId, first.id)).get();
    expect(row?.ownerId).toBe(a.user.id);
    const v1 = cursorV1(row?.seq ?? -1);

    const resumed = await drain(a, v1);
    expect(upserts(resumed.changes).map((n) => n.id)).toEqual([second.id, third.id]);
    expect(positionOf(resumed.cursor)).toBe(ownerSeqs(h, a.user.id).length);
    // The same place as the equivalent v2 cursor.
    expect(await feed(a, v1)).toEqual(await feed(a, cursorV2(row?.ownerSeq ?? -1)));
    // Once translated, the client keeps going on v2.
    expect(await feed(a, resumed.cursor)).toEqual({
      changes: [],
      cursor: resumed.cursor,
      hasMore: false,
    });
    // v1 position 0 means "after the very beginning".
    expect(upserts((await drain(a, cursorV1(0))).changes).map((n) => n.id)).toEqual([
      root.id,
      first.id,
      second.id,
      third.id,
    ]);
  });

  it("a v1 cursor must be one of the user's own rows: no oracle on other users' volume", async () => {
    const { h, a, root } = await setup();
    const b = await h.member("b@example.com");
    const bRoot = (await b.root()).folder;
    await a.mkdir(root.id, "x");
    const theirs = await b.mkdir(bRoot.id, "theirs");
    const bRow = h.db.select().from(changes).where(eq(changes.fileId, theirs.id)).get();
    // B's row has a perfectly real global seq, but it is not A's.
    const foreign = await a.get(
      `/api/changes?cursor=${encodeURIComponent(cursorV1(bRow?.seq ?? -1))}`,
    );
    expect([foreign.status, code(foreign)]).toEqual([400, "invalid_request"]);
    const beyond = await a.get(`/api/changes?cursor=${encodeURIComponent(cursorV1(10_000))}`);
    expect([beyond.status, code(beyond)]).toEqual([400, "invalid_request"]);
  });

  it("the unique (owner, owner_seq) index rejects a duplicated position", async () => {
    const { h, root } = await setup();
    const row = h.db.select().from(changes).where(eq(changes.fileId, root.id)).get();
    expect(row).toBeDefined();
    expect(() =>
      h.db
        .insert(changes)
        .values({
          ownerId: row?.ownerId ?? "",
          ownerSeq: row?.ownerSeq ?? 0,
          fileId: "x",
          createdAt: new Date(),
        })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("a fresh database has the unique owner/owner_seq index", () => {
    const h = harness();
    const idx = h.db
      .all<{ name: string; unique: number }>(sql`pragma index_list('changes')`)
      .find((r) => r.name === "changes_owner_owner_seq_idx");
    expect(idx?.unique).toBe(1);
  });
});

describe("change feed: migration to per-user sequences", () => {
  const drizzleDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

  /** A copy of the migrations that stops after `lastTag`, to build an older installation. */
  function migrationsUpTo(lastTag: string): string {
    const out = mkdtempSync(join(tmpdir(), "cloud-migrations-"));
    mkdirSync(join(out, "meta"));
    const journal = JSON.parse(readFileSync(join(drizzleDir, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const upTo = journal.entries.findIndex((e) => e.tag === lastTag);
    expect(upTo).toBeGreaterThanOrEqual(0);
    journal.entries = journal.entries.slice(0, upTo + 1);
    writeFileSync(join(out, "meta/_journal.json"), JSON.stringify(journal));
    for (const e of journal.entries)
      cpSync(join(drizzleDir, `${e.tag}.sql`), join(out, `${e.tag}.sql`));
    return out;
  }

  it("an installation from before the feed gets one row per file, numbered per owner", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsUpTo("0006_changes") });
    const user = sqlite.prepare(
      "insert into users (id, email, password_hash, role, quota_bytes, created_at) values (?, ?, 'x', 'member', 1, 0)",
    );
    user.run("ua", "a@example.com");
    user.run("ub", "b@example.com");
    const file = sqlite.prepare(
      "insert into files (id, owner_id, parent_id, name, kind, created_at, updated_at) values (?, ?, null, ?, 'folder', 0, 0)",
    );
    file.run("fa", "ua", "");
    file.run("fb", "ub", "");
    sqlite
      .prepare(
        "insert into files (id, owner_id, parent_id, name, kind, created_at, updated_at) values ('fa2', 'ua', 'fa', 'x', 'folder', 1, 1)",
      )
      .run();

    migrate(db, { migrationsFolder: drizzleDir });
    const rows = sqlite
      .prepare("select owner_id, owner_seq, file_id from changes order by owner_id, owner_seq")
      .all();
    expect(rows).toEqual([
      { owner_id: "ua", owner_seq: 1, file_id: "fa" },
      { owner_id: "ua", owner_seq: 2, file_id: "fa2" },
      { owner_id: "ub", owner_seq: 1, file_id: "fb" },
    ]);
  });

  it("numbers existing rows 1..n per owner in the order they were written", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsUpTo("0007_changes_backfill") });

    const user = sqlite.prepare(
      "insert into users (id, email, password_hash, role, quota_bytes, created_at) values (?, ?, 'x', 'member', 1, 0)",
    );
    user.run("ua", "a@example.com");
    user.run("ub", "b@example.com");
    const insert = sqlite.prepare(
      "insert into changes (owner_id, file_id, created_at) values (?, ?, 0)",
    );
    // Interleaved, as a shared instance produces them, with a gap left by a cascaded owner.
    for (const [owner, file] of [
      ["ua", "a1"],
      ["ub", "b1"],
      ["ub", "b2"],
      ["ua", "a2"],
      ["ua", "a1"],
      ["ub", "b1"],
      ["ua", "a3"],
    ] as const) {
      insert.run(owner, file);
    }
    sqlite
      .prepare(
        "insert into users (id, email, password_hash, role, quota_bytes, created_at) values ('uc', 'c@example.com', 'x', 'member', 1, 0)",
      )
      .run();
    insert.run("uc", "c1");
    sqlite.prepare("delete from users where id = 'uc'").run();
    const seqBefore = sqlite
      .prepare("select owner_id, seq, file_id from changes order by seq")
      .all();

    migrate(db, { migrationsFolder: drizzleDir });

    const after = sqlite
      .prepare("select owner_id, owner_seq, seq, file_id from changes order by seq")
      .all() as { owner_id: string; owner_seq: number; seq: number; file_id: string }[];
    expect(after.map((r) => [r.owner_id, r.seq, r.file_id])).toEqual(
      seqBefore.map((r) => {
        const x = r as { owner_id: string; seq: number; file_id: string };
        return [x.owner_id, x.seq, x.file_id];
      }),
    );
    expect(after.filter((r) => r.owner_id === "ua").map((r) => r.owner_seq)).toEqual([1, 2, 3, 4]);
    expect(after.filter((r) => r.owner_id === "ub").map((r) => r.owner_seq)).toEqual([1, 2, 3]);
    // The table keeps working: constraints, FK cascade and the global counter all survived.
    expect(() =>
      sqlite
        .prepare(
          "insert into changes (owner_id, owner_seq, file_id, created_at) values ('ua', 4, 'dup', 0)",
        )
        .run(),
    ).toThrow(/UNIQUE/);
    sqlite.prepare("delete from users where id = 'ub'").run();
    expect(sqlite.prepare("select count(*) as n from changes where owner_id = 'ub'").get()).toEqual(
      { n: 0 },
    );
    const next = sqlite
      .prepare(
        "insert into changes (owner_id, owner_seq, file_id, created_at) values ('ua', 5, 'ok', 0)",
      )
      .run();
    expect(Number(next.lastInsertRowid)).toBeGreaterThan(Math.max(...after.map((r) => r.seq)));
  });
});
