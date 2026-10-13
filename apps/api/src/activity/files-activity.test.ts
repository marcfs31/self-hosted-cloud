import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  activityPage,
  createdShareResponse,
  type ActivityEvent,
  type ActivityType,
} from "@cloud/shared";
import { activity, files } from "../db/schema/index.js";
import { purgeExpiredTrash } from "../files/trash.js";
import { harness, type Harness } from "../testing/harness.js";
import { createLink, visitor } from "../testing/shares.js";

const DAY = 24 * 60 * 60 * 1000;
type Session = Awaited<ReturnType<Harness["admin"]>>;

const FILE_TYPES: ActivityType[] = [
  "upload",
  "trash",
  "restore",
  "purge",
  "share_created",
  "share_revoked",
];

/** The user's file and share events, oldest first, as the activity API serves them. */
async function events(s: Session): Promise<ActivityEvent[]> {
  const res = await s.get("/api/activity?limit=200");
  expect(res.status).toBe(200);
  return activityPage
    .parse(res.body)
    .events.filter((e) => FILE_TYPES.includes(e.type))
    .reverse();
}

async function setup() {
  const h = harness();
  // Every clock read moves time on, so events never tie and their order is the order of the calls.
  let t = h.clock.t;
  Object.defineProperty(h.clock, "t", {
    get: () => (t += 1000),
    set: (value: number) => {
      t = value;
    },
  });
  const a = await h.admin();
  const root = (await a.root()).folder;
  return { h, a, root };
}

describe("activity: file and share events", () => {
  it("records an upload once, with the item name and kind, and a new version as an upload too", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "report.txt", Buffer.from("one"));
    expect(await events(a)).toMatchObject([
      { type: "upload", fileId: id, detail: { name: "report.txt", kind: "file" } },
    ]);

    await a.upload(root.id, "report.txt", Buffer.from("two"), id);
    const list = await events(a);
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({
      type: "upload",
      fileId: id,
      detail: { name: "report.txt", kind: "file" },
    });
  });

  it("records the name a clashing upload was given", async () => {
    const { a, root } = await setup();
    await a.upload(root.id, "a.txt", Buffer.from("1"));
    const second = await a.upload(root.id, "a.txt", Buffer.from("2"));
    expect((await events(a))[1]).toMatchObject({
      fileId: second,
      detail: { name: "a (1).txt" },
    });
  });

  it("records a drop-box upload on the owner, marked 'via: drop box', without the visitor's address", async () => {
    const { h, a, root } = await setup();
    const inbox = await a.mkdir(root.id, "Inbox");
    const link = await createLink(a, { fileId: inbox.id, allowUpload: true });
    const before = (await events(a)).length;

    const v = visitor(h, link);
    const bytes = Buffer.from("hi");
    const created = await v.tusCreate({ filename: "gift.txt" }, bytes.length);
    const done = await v.tusPatch(created.get("Location") ?? "", 0, bytes);
    expect(done.status).toBe(204);

    const list = await events(a);
    expect(list).toHaveLength(before + 1);
    expect(list.at(-1)).toMatchObject({
      type: "upload",
      fileId: done.get("Cloud-File-Id"),
      ip: null,
      detail: { name: "gift.txt", kind: "file", via: "drop box" },
    });
  });

  it("records trash and restore once each, for a folder as for a file", async () => {
    const { a, root } = await setup();
    const dir = await a.mkdir(root.id, "Dir");
    await a.upload(dir.id, "inside.txt", Buffer.from("i"));
    const before = (await events(a)).length;

    expect((await a.del(`/api/files/${dir.id}`)).status).toBe(204);
    expect((await a.post(`/api/trash/${dir.id}/restore`)).status).toBe(200);
    const list = (await events(a)).slice(before);
    // Only the item the user acted on, not each descendant.
    expect(list).toMatchObject([
      { type: "trash", fileId: dir.id, detail: { name: "Dir", kind: "folder" } },
      { type: "restore", fileId: dir.id, detail: { name: "Dir", kind: "folder" } },
    ]);
  });

  it("records the name a restored item ended up with", async () => {
    const { a, root } = await setup();
    const first = await a.upload(root.id, "a.txt", Buffer.from("1"));
    await a.del(`/api/files/${first}`);
    await a.upload(root.id, "a.txt", Buffer.from("2"));
    await a.post(`/api/trash/${first}/restore`);
    expect((await events(a)).at(-1)).toMatchObject({
      type: "restore",
      fileId: first,
      detail: { name: "a (1).txt" },
    });
  });

  it("records a purge for the item the user deleted forever, and one per item for empty trash", async () => {
    const { a, root } = await setup();
    const dir = await a.mkdir(root.id, "Dir");
    await a.upload(dir.id, "inside.txt", Buffer.from("i"));
    const x = await a.upload(root.id, "x.txt", Buffer.from("x"));
    const y = await a.upload(root.id, "y.txt", Buffer.from("y"));
    for (const id of [dir.id, x, y]) await a.del(`/api/files/${id}`);
    const before = (await events(a)).length;

    expect((await a.del(`/api/trash/${dir.id}`)).status).toBe(204);
    expect((await a.del("/api/trash")).status).toBe(204);
    const list = (await events(a)).slice(before);
    expect(list.map((e) => e.type)).toEqual(["purge", "purge", "purge"]);
    expect(list[0]).toMatchObject({
      fileId: dir.id,
      detail: { name: "Dir", kind: "folder" },
    });
    expect(
      list
        .slice(1)
        .map((e) => e.fileId)
        .sort(),
    ).toEqual([x, y].sort());
    for (const e of list) expect(e.detail).not.toHaveProperty("reason");
  });

  it("records the retention sweep's purge with reason 'retention'", async () => {
    const { h, a, root } = await setup();
    const old = await a.upload(root.id, "old.txt", Buffer.from("o"));
    h.clock.t -= 31 * DAY;
    await a.del(`/api/files/${old}`);
    h.clock.t += 31 * DAY;
    expect(await purgeExpiredTrash({ db: h.db, dataDir: h.dataDir, now: () => h.clock.t })).toBe(1);
    expect((await events(a)).at(-1)).toMatchObject({
      type: "purge",
      fileId: old,
      detail: { name: "old.txt", kind: "file", reason: "retention" },
    });
  });

  it("records share creation and revocation with the item, never the token", async () => {
    const { a, root } = await setup();
    const dir = await a.mkdir(root.id, "Shared");
    const created = await a.post("/api/shares", { fileId: dir.id });
    expect(created.status).toBe(201);
    const { share, token } = createdShareResponse.parse(created.body);
    expect((await a.del(`/api/shares/${share.id}`)).status).toBe(204);

    const list = await events(a);
    expect(list).toMatchObject([
      { type: "share_created", fileId: dir.id, detail: { name: "Shared", kind: "folder" } },
      { type: "share_revoked", fileId: dir.id, detail: { name: "Shared", kind: "folder" } },
    ]);
    const raw = JSON.stringify(list);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(share.id);
  });

  it("a file share records the file's name and kind", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "doc.pdf", Buffer.from("d"));
    await createLink(a, { fileId: id });
    expect((await events(a)).at(-1)).toMatchObject({
      type: "share_created",
      fileId: id,
      detail: { name: "doc.pdf", kind: "file" },
    });
  });

  it("records the client address of the user's own actions", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "a.txt", Buffer.from("x"));
    await a.del(`/api/files/${id}`);
    const list = await events(a);
    expect(list.map((e) => e.type)).toEqual(["upload", "trash"]);
    for (const e of list) expect(e.ip).toEqual(expect.any(String));
  });

  it("each user sees only their own events", async () => {
    const { h, a, root } = await setup();
    const b = await h.member("b@example.com");
    await a.upload(root.id, "mine.txt", Buffer.from("m"));
    expect(await events(b)).toEqual([]);
  });
});

describe("activity: atomic with the action", () => {
  it("a failed action leaves no event: refused trash, share and revoke", async () => {
    const { a, root } = await setup();
    const id = await a.upload(root.id, "a.txt", Buffer.from("x"));
    const before = await events(a);
    expect((await a.del(`/api/files/${root.id}`)).status).toBe(409);
    expect((await a.del("/api/files/nope")).status).toBe(404);
    expect((await a.post("/api/shares", { fileId: root.id })).status).toBe(409);
    expect((await a.post("/api/shares", { fileId: id, allowUpload: true })).status).toBe(400);
    expect((await a.del("/api/shares/nope")).status).toBe(404);
    expect((await a.post("/api/trash/nope/restore")).status).toBe(404);
    expect((await a.del(`/api/trash/${id}`)).status).toBe(404);
    expect(await events(a)).toEqual(before);
  });

  it("an action whose event cannot be written rolls the action back", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "a.txt", Buffer.from("x"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.db.run(sql`drop table activity`);
    expect((await a.del(`/api/files/${id}`)).status).toBe(500);
    quiet.mockRestore();
    expect(h.db.select().from(files).where(eq(files.id, id)).get()?.deletedAt).toBeNull();
  });

  it("a purge whose event cannot be written deletes nothing", async () => {
    const { h, a, root } = await setup();
    const id = await a.upload(root.id, "a.txt", Buffer.from("x"));
    await a.del(`/api/files/${id}`);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.db.run(sql`drop table activity`);
    expect((await a.del(`/api/trash/${id}`)).status).toBe(500);
    quiet.mockRestore();
    expect(h.db.select().from(files).where(eq(files.id, id)).get()).toBeDefined();
  });

  it("no event is written by reads", async () => {
    const { h, a, root } = await setup();
    await a.upload(root.id, "a.txt", Buffer.from("x"));
    const count = h.db.select().from(activity).all().length;
    await a.get("/api/files/root");
    await a.get("/api/trash");
    await a.get("/api/shares");
    await a.get("/api/changes");
    expect(h.db.select().from(activity).all()).toHaveLength(count);
  });
});
