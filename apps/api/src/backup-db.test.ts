import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { backupDatabase, runCli } from "./backup-db.js";
import { openDatabase, type Db } from "./db/client.js";
import { users } from "./db/schema/index.js";

const open: Db[] = [];
afterEach(() => {
  for (const db of open.splice(0)) if (db.$client.open) db.$client.close();
});

/** A migrated WAL database with `rows` users, left open like the serving API would. */
function liveDatabase(rows: number) {
  const dataDir = mkdtempSync(join(tmpdir(), "cloud-backup-"));
  const source = join(dataDir, "db", "cloud.sqlite");
  const db = openDatabase(source);
  open.push(db);
  for (let i = 0; i < rows; i++) {
    db.insert(users)
      .values({
        id: `user-${i}`,
        email: `u${i}@example.com`,
        passwordHash: "x",
        role: "member",
        quotaBytes: 1,
        createdAt: new Date(0),
      })
      .run();
  }
  return { dataDir, source, db };
}

function inspect(path: string) {
  const copy = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return {
      integrity: copy.pragma("integrity_check", { simple: true }),
      journalMode: copy.pragma("journal_mode", { simple: true }),
      rows: (copy.prepare("select count(*) as n from users").get() as { n: number }).n,
    };
  } finally {
    copy.close();
  }
}

describe("backupDatabase", () => {
  it("copies a live WAL database with its rows, intact, as one self-contained file", async () => {
    const { dataDir, source } = liveDatabase(25);
    const dest = join(dataDir, "backups", "nested", "cloud.sqlite");

    await backupDatabase(source, dest);

    expect(inspect(dest)).toEqual({ integrity: "ok", journalMode: "delete", rows: 25 });
    expect(readdirSync(join(dataDir, "backups", "nested"))).toEqual(["cloud.sqlite"]);
  });

  it("captures rows that exist only in the WAL and keeps the live database writable", async () => {
    const { dataDir, source, db } = liveDatabase(3);
    const dest = join(dataDir, "backups", "cloud.sqlite");
    db.$client.pragma("wal_autocheckpoint = 0"); // keep the rows in the -wal file
    expect(existsSync(`${source}-wal`)).toBe(true);

    await backupDatabase(source, dest);
    db.insert(users)
      .values({
        id: "after",
        email: "after@example.com",
        passwordHash: "x",
        role: "member",
        quotaBytes: 1,
        createdAt: new Date(0),
      })
      .run();

    expect(inspect(dest).rows).toBe(3);
    expect(db.select().from(users).all()).toHaveLength(4);
  });

  it("replaces an existing destination atomically and discards a stale .tmp", async () => {
    const { dataDir, source } = liveDatabase(2);
    const dest = join(dataDir, "backups", "cloud.sqlite");
    mkdirSync(join(dataDir, "backups"));
    writeFileSync(dest, "old, not a database");
    writeFileSync(`${dest}.tmp`, "leftover from a crashed run");

    await backupDatabase(source, dest);

    expect(inspect(dest).rows).toBe(2);
    expect(existsSync(`${dest}.tmp`)).toBe(false);
  });

  it("fails clearly when the database is missing and creates no destination", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "cloud-backup-"));
    const dest = join(dataDir, "out", "b.sqlite");
    await expect(backupDatabase(join(dataDir, "db", "cloud.sqlite"), dest)).rejects.toThrow(
      /database not found/,
    );
    expect(existsSync(dest)).toBe(false);
  });

  it("refuses to overwrite the live database", async () => {
    const { source } = liveDatabase(1);
    await expect(backupDatabase(source, source)).rejects.toThrow(/live database/);
    expect(inspect(source).rows).toBe(1);
  });

  it("keeps the previous backup and leaves no .tmp when the source is not a database", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "cloud-backup-"));
    const source = join(dataDir, "db", "cloud.sqlite");
    mkdirSync(join(dataDir, "db"));
    writeFileSync(source, "this is not sqlite ".repeat(100));
    const dest = join(dataDir, "backups", "cloud.sqlite");
    mkdirSync(join(dataDir, "backups"));
    writeFileSync(dest, "previous good backup");

    await expect(backupDatabase(source, dest)).rejects.toThrow();

    expect(existsSync(`${dest}.tmp`)).toBe(false);
    expect(readdirSync(join(dataDir, "backups"))).toEqual(["cloud.sqlite"]);
  });
});

describe("runCli", () => {
  const run = async (argv: string[], env: NodeJS.ProcessEnv) => {
    const lines: string[] = [];
    const code = await runCli(argv, env, (l) => lines.push(l));
    return { code, stderr: lines.join("\n") };
  };

  it("exits 0 and writes the backup from <DATA_DIR>/db/cloud.sqlite", async () => {
    const { dataDir } = liveDatabase(4);
    const dest = join(dataDir, "backups", "cloud.sqlite");
    expect(await run([dest], { DATA_DIR: dataDir })).toEqual({ code: 0, stderr: "" });
    expect(inspect(dest).rows).toBe(4);
  });

  it("exits 1 naming DATA_DIR when it is not set", async () => {
    const { code, stderr } = await run(["/tmp/x.sqlite"], {});
    expect(code).toBe(1);
    expect(stderr).toBe("backup-db: DATA_DIR is not set");
  });

  it("exits 1 naming the missing database", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "cloud-backup-"));
    const { code, stderr } = await run([join(dataDir, "b.sqlite")], { DATA_DIR: dataDir });
    expect(code).toBe(1);
    expect(stderr).toContain("database not found");
    expect(stderr).toContain(join(dataDir, "db", "cloud.sqlite"));
  });

  it("exits 1 when the destination cannot be written", async () => {
    const { dataDir } = liveDatabase(1);
    const blocker = join(dataDir, "blocker");
    writeFileSync(blocker, "a file, not a directory");
    const { code, stderr } = await run([join(blocker, "b.sqlite")], { DATA_DIR: dataDir });
    expect(code).toBe(1);
    expect(stderr).toMatch(/^backup-db: /);
  });

  it("exits 2 with usage when the destination argument is missing or extra", async () => {
    expect((await run([], { DATA_DIR: "/x" })).code).toBe(2);
    expect((await run(["a", "b"], { DATA_DIR: "/x" })).code).toBe(2);
  });
});
