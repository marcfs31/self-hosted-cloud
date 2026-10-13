import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { errorResponse, searchResponse, type SearchResult } from "@cloud/shared";
import { files } from "../db/schema/index.js";
import { harness, type Harness } from "../testing/harness.js";

type Session = Awaited<ReturnType<Harness["admin"]>>;

async function twoUsers(h: Harness) {
  const a = await h.admin();
  const b = await h.member("b@example.com");
  return { a, b };
}

async function find(s: Session, q: string, limit?: number): Promise<SearchResult[]> {
  const res = await s.get(
    `/api/search?q=${encodeURIComponent(q)}${limit === undefined ? "" : `&limit=${limit}`}`,
  );
  expect(res.status, q).toBe(200);
  return searchResponse.parse(res.body).results;
}

async function names(s: Session, q: string, limit?: number): Promise<string[]> {
  return (await find(s, q, limit)).map((r) => r.node.name);
}

/** Direct row insert: search tests need many files, not many uploads. */
function addFile(
  h: Harness,
  s: Session,
  parentId: string,
  name: string,
  updatedAt = h.clock.t,
): string {
  const id = crypto.randomUUID();
  h.db
    .insert(files)
    .values({
      id,
      ownerId: s.user.id,
      parentId,
      name,
      kind: "file",
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
    })
    .run();
  return id;
}

describe("GET /api/search matching", () => {
  it("finds a substring in the middle of a name, ignoring case", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    addFile(h, a, root.id, "Quarterly Budget Report.pdf");
    addFile(h, a, root.id, "holiday.jpg");
    expect(await names(a, "budget")).toEqual(["Quarterly Budget Report.pdf"]);
    expect(await names(a, "BUDGET RE")).toEqual(["Quarterly Budget Report.pdf"]);
    expect(await names(a, "dget Rep")).toEqual(["Quarterly Budget Report.pdf"]);
    expect(await names(a, ".pdf")).toEqual(["Quarterly Budget Report.pdf"]);
    expect(await names(a, "nothing-like-this")).toEqual([]);
  });

  it("finds folders as well as files, and returns a full file node", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const dir = await a.mkdir(root.id, "Project Plans");
    const id = await a.upload(dir.id, "plan-2026.txt", Buffer.from("hello"));
    const [folder] = await find(a, "plans");
    expect(folder?.node).toMatchObject({ id: dir.id, kind: "folder", name: "Project Plans" });
    const [file] = await find(a, "plan-20");
    expect(file?.node).toMatchObject({
      id,
      kind: "file",
      size: 5,
      versionCount: 1,
      parentId: dir.id,
    });
  });

  it("follows trigram behaviour for accents: case folds, diacritics do not", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    addFile(h, a, root.id, "Café Menu.txt");
    addFile(h, a, root.id, "ÉCOLE notes.txt");
    expect(await names(a, "café")).toEqual(["Café Menu.txt"]);
    expect(await names(a, "CAFÉ")).toEqual(["Café Menu.txt"]);
    expect(await names(a, "école")).toEqual(["ÉCOLE notes.txt"]);
    // Documented: "cafe" is not "café" (no diacritic folding).
    expect(await names(a, "cafe")).toEqual([]);
    expect(await names(a, "cafe menu")).toEqual([]);
  });

  it("treats FTS syntax and quotes in the query as plain text", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    addFile(h, a, root.id, 'say "hi" now.txt');
    addFile(h, a, root.id, "alpha beta.txt");
    expect(await names(a, 'say "hi"')).toEqual(['say "hi" now.txt']);
    expect(await names(a, '"')).toEqual(['say "hi" now.txt']);
    for (const q of [
      "alpha OR beta",
      "alp*",
      "name:alpha",
      "NEAR(alpha beta)",
      "alpha -beta",
      "(((",
      "'; drop table files;--",
    ]) {
      expect(await names(a, q), q).toEqual([]);
    }
    expect(await names(a, "alpha beta")).toEqual(["alpha beta.txt"]);
  });

  it("uses LIKE for one and two characters, with % and _ literal", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    addFile(h, a, root.id, "100% real.txt");
    addFile(h, a, root.id, "a_b.txt");
    addFile(h, a, root.id, "axb.txt");
    addFile(h, a, root.id, "back\\slash.txt");
    addFile(h, a, root.id, "Zed.txt");
    expect(await names(a, "%")).toEqual(["100% real.txt"]);
    expect(await names(a, "0%")).toEqual(["100% real.txt"]);
    expect(await names(a, "_")).toEqual(["a_b.txt"]);
    expect((await names(a, "a_")).sort()).toEqual(["a_b.txt"]);
    expect(await names(a, "\\")).toEqual(["back\\slash.txt"]);
    expect(await names(a, "ze")).toEqual(["Zed.txt"]);
    expect(await names(a, "Z")).toEqual(["Zed.txt"]);
    expect(await names(a, "xb")).toEqual(["axb.txt"]);
  });

  it("excludes the root folder, whose name is empty", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    await a.root();
    expect(await names(a, "a")).toEqual([]);
    expect(await names(a, "%")).toEqual([]);
  });
});

describe("GET /api/search scope", () => {
  it("requires a session", async () => {
    const h = harness();
    await h.admin();
    const { default: request } = await import("supertest");
    const res = await request(h.app).get("/api/search?q=abc");
    expect(res.status).toBe(401);
    expect(errorResponse.parse(res.body).error.code).toBe("unauthenticated");
  });

  it("never shows user A's files to user B, nor B's to A", async () => {
    const h = harness();
    const { a, b } = await twoUsers(h);
    const aRoot = (await a.root()).folder;
    const bRoot = (await b.root()).folder;
    addFile(h, a, aRoot.id, "secret-plan.txt");
    addFile(h, a, aRoot.id, "xy");
    addFile(h, b, bRoot.id, "shared-name.txt");
    addFile(h, a, aRoot.id, "shared-name.txt");
    expect(await names(b, "secret")).toEqual([]);
    expect(await names(b, "xy")).toEqual([]);
    expect(await names(b, "plan")).toEqual([]);
    expect(await names(b, "shared-name")).toEqual(["shared-name.txt"]);
    const mine = await find(b, "shared-name");
    expect(mine[0]?.node.parentId).toBe(bRoot.id);
    expect(await names(a, "secret")).toEqual(["secret-plan.txt"]);
  });

  it("excludes trashed items and descendants of trashed folders, and restores them", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const dir = await a.mkdir(root.id, "needle-dir");
    const sub = await a.mkdir(dir.id, "needle-sub");
    addFile(h, a, sub.id, "needle-deep.txt");
    addFile(h, a, sub.id, "n1");
    const single = addFile(h, a, root.id, "needle-single.txt");
    addFile(h, a, root.id, "needle-alive.txt");
    expect((await names(a, "needle")).length).toBe(5);

    expect((await a.del(`/api/files/${dir.id}`)).status).toBe(204);
    expect((await a.del(`/api/files/${single}`)).status).toBe(204);
    expect(await names(a, "needle")).toEqual(["needle-alive.txt"]);
    expect(await names(a, "n1")).toEqual([]);

    expect((await a.post(`/api/trash/${dir.id}/restore`)).status).toBe(200);
    expect((await names(a, "needle")).sort()).toEqual(
      ["needle-alive.txt", "needle-deep.txt", "needle-dir", "needle-sub"].sort(),
    );
    expect(await names(a, "n1")).toEqual(["n1"]);
    expect((await a.post(`/api/trash/${single}/restore`)).status).toBe(200);
    expect((await names(a, "needle")).length).toBe(5);
  });

  it("keeps trash scoped per owner", async () => {
    const h = harness();
    const { a, b } = await twoUsers(h);
    const aRoot = (await a.root()).folder;
    const bRoot = (await b.root()).folder;
    const aDir = await a.mkdir(aRoot.id, "gone");
    addFile(h, a, aDir.id, "gone-child.txt");
    addFile(h, b, bRoot.id, "gone-b.txt");
    expect((await a.del(`/api/files/${aDir.id}`)).status).toBe(204);
    expect(await names(b, "gone")).toEqual(["gone-b.txt"]);
    expect(await names(a, "gone")).toEqual([]);
  });
});

describe("GET /api/search index maintenance", () => {
  it("follows renames", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const id = addFile(h, a, root.id, "before-name.txt");
    expect(await names(a, "before")).toEqual(["before-name.txt"]);
    expect((await a.patch(`/api/files/${id}`, { name: "after-name.txt" })).status).toBe(200);
    expect(await names(a, "before")).toEqual([]);
    expect(await names(a, "after")).toEqual(["after-name.txt"]);
    expect(await names(a, "af")).toEqual(["after-name.txt"]);
  });

  it("follows moves and reports the new path", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const one = await a.mkdir(root.id, "one");
    const two = await a.mkdir(root.id, "two");
    const id = addFile(h, a, one.id, "mover.txt");
    expect((await a.patch(`/api/files/${id}`, { parentId: two.id })).status).toBe(200);
    const [hit] = await find(a, "mover");
    expect(hit?.path).toEqual([
      { id: root.id, name: "" },
      { id: two.id, name: "two" },
    ]);
  });

  it("removes purged items, including a folder's cascaded descendants", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const dir = await a.mkdir(root.id, "purge-dir");
    addFile(h, a, dir.id, "purge-child.txt");
    const lone = addFile(h, a, root.id, "purge-lone.txt");
    expect((await a.del(`/api/files/${dir.id}`)).status).toBe(204);
    expect((await a.del(`/api/files/${lone}`)).status).toBe(204);
    expect((await a.del(`/api/trash/${dir.id}`)).status).toBe(204);
    expect((await a.del("/api/trash")).status).toBe(204);
    expect(await names(a, "purge")).toEqual([]);
    const left = h.db.all<{ n: number }>(
      sql`select count(*) as n from files_fts where files_fts match '"purge"'`,
    );
    expect(left[0]?.n).toBe(0);
    // Raises if the index and the files table disagree.
    expect(() =>
      h.db.run(sql`insert into files_fts(files_fts, rank) values ('integrity-check', 1)`),
    ).not.toThrow();
  });

  it("indexes names that existed before the index (rebuild matches the triggers)", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    addFile(h, a, root.id, "legacy-file.txt");
    h.db.run(sql`insert into files_fts(files_fts) values ('rebuild')`);
    expect(await names(a, "legacy")).toEqual(["legacy-file.txt"]);
  });
});

describe("GET /api/search ordering and limit", () => {
  it("orders exact name, then prefix, then most recently updated", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const T = 1_700_000_000_000;
    addFile(h, a, root.id, "old-notes-archive.txt", T);
    addFile(h, a, root.id, "my notes.txt", T + 3000);
    addFile(h, a, root.id, "notes-2024.txt", T + 1000);
    addFile(h, a, root.id, "Notes", T); // exact, case-insensitively
    addFile(h, a, root.id, "notes-2025.txt", T + 2000);
    addFile(h, a, root.id, "recent notes backup.txt", T + 9000);
    expect(await names(a, "notes")).toEqual([
      "Notes",
      "notes-2025.txt",
      "notes-2024.txt",
      "recent notes backup.txt",
      "my notes.txt",
      "old-notes-archive.txt",
    ]);
  });

  it("applies the same ordering to short LIKE queries", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const T = 1_700_000_000_000;
    addFile(h, a, root.id, "zz-old", T);
    addFile(h, a, root.id, "xzz", T + 5000);
    addFile(h, a, root.id, "ZZ", T - 5000);
    addFile(h, a, root.id, "zz-new", T + 1000);
    expect(await names(a, "zz")).toEqual(["ZZ", "zz-new", "zz-old", "xzz"]);
  });

  it("honours limit (default 50) and applies it after ranking", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const T = 1_700_000_000_000;
    for (let i = 0; i < 60; i++)
      addFile(h, a, root.id, `item-${String(i).padStart(2, "0")}`, T + i);
    addFile(h, a, root.id, "item", T - 1000); // exact match, oldest: must still come first
    expect((await find(a, "item")).length).toBe(50);
    const three = await names(a, "item", 3);
    expect(three).toEqual(["item", "item-59", "item-58"]);
    expect((await find(a, "item", 100)).length).toBe(61);
    expect((await find(a, "it", 2)).length).toBe(2);
  });

  it("rejects an invalid query with 400", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const bad = [
      "/api/search",
      "/api/search?q=",
      "/api/search?q=%20%20",
      `/api/search?q=${"x".repeat(101)}`,
      "/api/search?q=abc&limit=0",
      "/api/search?q=abc&limit=101",
      "/api/search?q=abc&limit=x",
      "/api/search?q=abc&q=def",
    ];
    for (const path of bad) {
      const res = await a.get(path);
      expect(res.status, path).toBe(400);
      expect(errorResponse.parse(res.body).error.code).toBe("invalid_request");
    }
    expect((await a.get(`/api/search?q=${"x".repeat(100)}`)).status).toBe(200);
  });
});

describe("GET /api/search breadcrumbs", () => {
  it("returns the ancestors root first, excluding the node", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const x = await a.mkdir(root.id, "Photos");
    const y = await a.mkdir(x.id, "2026");
    addFile(h, a, y.id, "beach.jpg");
    addFile(h, a, root.id, "beach-top.jpg");
    const results = await find(a, "beach");
    const deep = results.find((r) => r.node.name === "beach.jpg");
    expect(deep?.path).toEqual([
      { id: root.id, name: "" },
      { id: x.id, name: "Photos" },
      { id: y.id, name: "2026" },
    ]);
    const top = results.find((r) => r.node.name === "beach-top.jpg");
    expect(top?.path).toEqual([{ id: root.id, name: "" }]);
    const [folder] = await find(a, "2026");
    expect(folder?.path.map((p) => p.name)).toEqual(["", "Photos"]);
  });
});

describe("GET /api/search performance", () => {
  it("answers a 3-character query over 100 000 files quickly", async () => {
    const h = harness();
    const { a } = await twoUsers(h);
    const root = (await a.root()).folder;
    const trashedDir = await a.mkdir(root.id, "trashed-dir");
    const at = h.clock.t;
    h.db.transaction((tx) => {
      tx.run(sql`
        with recursive n(i) as (select 1 union all select i + 1 from n where i < 100000)
        insert into files (id, owner_id, parent_id, name, kind, created_at, updated_at)
        select 'perf-' || i, ${a.user.id}, ${root.id},
               'doc-' || printf('%06d', i) || '.txt', 'file', ${at}, ${at} - i
          from n`);
      tx.update(files).set({ name: "unique-zqx-file.txt" }).where(eq(files.id, "perf-77777")).run();
    });
    // A trashed folder with content, so the inactive-subtree path is exercised.
    for (let i = 0; i < 50; i++) addFile(h, a, trashedDir.id, `trashed-${i}-zqx.txt`);
    expect((await a.del(`/api/files/${trashedDir.id}`)).status).toBe(204);

    const timings: Record<string, number> = {};
    const timed = async (q: string) => {
      const start = performance.now();
      const results = await find(a, q);
      timings[q] = Math.round(performance.now() - start);
      return results;
    };
    expect((await timed("zqx")).map((r) => r.node.name)).toEqual(["unique-zqx-file.txt"]);
    expect((await timed("doc")).length).toBe(50);
    expect((await timed("077")).length).toBe(50);
    expect((await timed("nope")).length).toBe(0);
    expect((await timed("-0")).length).toBe(50); // LIKE path, matches every row
    console.info(`search timings over 100000 files (ms): ${JSON.stringify(timings)}`);
    for (const [q, ms] of Object.entries(timings)) expect(ms, q).toBeLessThan(1000);
  }, 60_000);
});
