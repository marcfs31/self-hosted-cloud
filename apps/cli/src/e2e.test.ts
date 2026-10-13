import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  folderListing,
  searchResponse,
  trashListing,
  versionListing,
  type FileNode,
} from "@cloud/shared";
import { makeCli, startApi, type LiveApi } from "./testing/live-api.js";

let api: LiveApi;
let work: string;
let cli: ReturnType<typeof makeCli>;
const BIG = randomBytes(3 * 1024 * 1024);
const SMALL = Buffer.from("hello from the cloud cli\n");

async function listing(path = "/api/files/root") {
  const res = await api.bearer(path);
  expect(res.status).toBe(200);
  return folderListing.parse(await res.json());
}

async function child(name: string, parent?: string): Promise<FileNode> {
  const found = (await listing(parent ? `/api/folders/${parent}` : undefined)).children.find(
    (c) => c.name === name,
  );
  if (!found) throw new Error(`${name} not found`);
  return found;
}

beforeAll(async () => {
  api = await startApi();
  work = mkdtempSync(join(tmpdir(), "cloud-cli-work-"));
  mkdirSync(join(work, "home"));
  cli = makeCli({ configDir: join(work, "config"), cwd: join(work, "home") });
  writeFileSync(join(work, "home", "big.bin"), BIG);
  writeFileSync(join(work, "home", "small.txt"), SMALL);
});

afterAll(async () => {
  await api.close();
});

describe("cloud against a live API", () => {
  it("rejects commands before login with exit 2", async () => {
    const res = await cli(["ls"]);
    expect(res.code).toBe(2);
    expect(res.err).toContain("cloud login");
  });

  it("login with a wrong app password exits 2 and stores nothing", async () => {
    const res = await cli(["login", "--server", api.base], {
      env: { CLOUD_TOKEN: "cloud_not-a-real-token" },
    });
    expect(res.code).toBe(2);
    expect(res.err).toContain("did not accept");
    expect((await cli(["whoami"])).code).toBe(2);
  });

  it("login reads CLOUD_TOKEN, stores a 0600 file in a 0700 directory and never prints the token", async () => {
    const res = await cli(["login", "--server", api.base, "--email", "ADMIN@example.com"], {
      env: { CLOUD_TOKEN: api.token },
    });
    expect(res.code).toBe(0);
    expect(res.out).toContain("admin@example.com");
    expect(res.out + res.err).not.toContain(api.token);
    const dir = join(work, "config");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as {
      server: string;
      email: string;
      token: string;
    };
    expect(stored).toEqual({ server: api.base, email: "admin@example.com", token: api.token });
  });

  it("login refuses an app password that belongs to another account", async () => {
    const res = await cli(["login", "--server", api.base, "--email", "someone@else.org"], {
      env: { CLOUD_TOKEN: api.token },
    });
    expect(res.code).toBe(2);
    expect(res.err).toContain("admin@example.com");
  });

  it("whoami shows the account and --json parses", async () => {
    const human = await cli(["whoami"]);
    expect(human.code).toBe(0);
    expect(human.out).toContain("admin@example.com (admin)");
    const json = JSON.parse((await cli(["whoami", "--json"])).out) as Record<string, unknown>;
    expect(json).toMatchObject({ email: "admin@example.com", role: "admin", server: api.base });
  });

  it("mkdir -p creates nested folders and is idempotent; plain mkdir conflicts", async () => {
    const created = await cli(["mkdir", "-p", "/docs/2026/reports", "--json"]);
    expect(created.code).toBe(0);
    expect(JSON.parse(created.out)).toMatchObject({ path: "/docs/2026/reports", created: true });
    const again = await cli(["mkdir", "-p", "docs/2026/reports"]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("Already exists");
    const conflict = await cli(["mkdir", "/docs"]);
    expect(conflict.code).toBe(4);
    const noParent = await cli(["mkdir", "/missing/child"]);
    expect(noParent.code).toBe(3);
  });

  it("uploads a 3 MB file in chunks and a small file; ls shows them", async () => {
    const before = api.patches();
    const res = await cli(["upload", "big.bin", "small.txt", "--to", "/docs"], {
      chunkSize: 1024 * 1024,
    });
    expect(res.code).toBe(0);
    expect(res.out).toContain("Uploaded /docs/big.bin (3.0 MiB)");
    expect(res.out).toContain("Uploaded /docs/small.txt");
    // 3 chunks for the big file, 1 for the small one
    expect(api.patches() - before).toBe(4);

    const ls = await cli(["ls", "/docs"]);
    expect(ls.code).toBe(0);
    expect(ls.out).toMatch(/folder\s+-\s+\S+ \S+\s+2026\//);
    expect(ls.out).toMatch(/file\s+3\.0 MiB\s+\S+ \S+\s+big\.bin/);
    expect(ls.out).toMatch(/file\s+25 B\s+\S+ \S+\s+small\.txt/);

    const json = JSON.parse((await cli(["ls", "/docs", "--json"])).out) as {
      path: string;
      items: { name: string; kind: string; size: number }[];
    };
    expect(json.path).toBe("/docs");
    expect(json.items.map((i) => i.name)).toEqual(["2026", "big.bin", "small.txt"]);
    expect(json.items.find((i) => i.name === "big.bin")?.size).toBe(BIG.length);
  });

  it("uploads an empty file", async () => {
    writeFileSync(join(work, "home", "empty.txt"), "");
    const res = await cli(["upload", "empty.txt", "--to", "/docs", "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.out) as { uploaded: { path: string; size: number }[] };
    expect(out.uploaded).toMatchObject([{ path: "/docs/empty.txt", size: 0 }]);
  });

  it("uploading the same name again keeps both", async () => {
    const res = await cli(["upload", "small.txt", "--to", "/docs", "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.out) as { uploaded: { path: string; replaced: boolean }[] };
    expect(out.uploaded).toMatchObject([{ path: "/docs/small (1).txt", replaced: false }]);
    const docs = await child("docs");
    const names = (await listing(`/api/folders/${docs.id}`)).children.map((c) => c.name);
    expect(names).toContain("small.txt");
    expect(names).toContain("small (1).txt");
  });

  it("--replace adds a version to the existing file", async () => {
    writeFileSync(join(work, "home", "small.txt"), "second version\n");
    const res = await cli(["upload", "small.txt", "--to", "/docs", "--replace"]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("(new version)");
    const docs = await child("docs");
    const file = await child("small.txt", docs.id);
    expect(file.versionCount).toBe(2);
    const versions = versionListing.parse(
      await (await api.bearer(`/api/files/${file.id}/versions`)).json(),
    );
    expect(versions.versions).toHaveLength(2);
    const names = (await listing(`/api/folders/${docs.id}`)).children.map((c) => c.name);
    expect(names.filter((n) => n.startsWith("small"))).toEqual(["small (1).txt", "small.txt"]);
    writeFileSync(join(work, "home", "small.txt"), SMALL);
  });

  it("--replace and --keep-both together are a usage error", async () => {
    const res = await cli(["upload", "small.txt", "--replace", "--keep-both"]);
    expect(res.code).toBe(1);
    expect(res.err).toContain("not both");
  });

  it("download matches the bytes and refuses to overwrite without --force", async () => {
    const out = join(work, "downloads");
    mkdirSync(out);
    const first = await cli(["download", "/docs/big.bin", out]);
    expect(first.code).toBe(0);
    expect(readFileSync(join(out, "big.bin")).equals(BIG)).toBe(true);

    const second = await cli(["download", "/docs/big.bin", out]);
    expect(second.code).toBe(4);
    expect(second.err).toContain("--force");

    writeFileSync(join(out, "big.bin"), "stale");
    const forced = await cli([
      "download",
      "/docs/big.bin",
      join(out, "big.bin"),
      "--force",
      "--json",
    ]);
    expect(forced.code).toBe(0);
    expect(JSON.parse(forced.out)).toMatchObject({ remote: "/docs/big.bin", size: BIG.length });
    expect(readFileSync(join(out, "big.bin")).equals(BIG)).toBe(true);
  });

  it("download defaults to the working directory and leaves no temp files", async () => {
    const cwd = mkdtempSync(join(work, "cwd-"));
    const res = await cli(["download", "/docs/empty.txt"], { cwd });
    expect(res.code).toBe(0);
    expect(readFileSync(join(cwd, "empty.txt"))).toHaveLength(0);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(cwd)).toEqual(["empty.txt"]);
  });

  it("download of a folder suggests a share", async () => {
    const res = await cli(["download", "/docs"]);
    expect(res.code).toBe(1);
    expect(res.err).toContain("cloud share");
  });

  it("mv renames and moves into folders", async () => {
    const renamed = await cli(["mv", "/docs/empty.txt", "/docs/nothing.txt"]);
    expect(renamed.code).toBe(0);
    expect(renamed.out).toContain("/docs/nothing.txt");
    const moved = await cli(["mv", "/docs/nothing.txt", "/docs/2026", "--json"]);
    expect(moved.code).toBe(0);
    expect(JSON.parse(moved.out)).toMatchObject({
      from: "/docs/nothing.txt",
      to: "/docs/2026/nothing.txt",
    });
    expect((await cli(["ls", "/docs/2026/nothing.txt"])).out).toContain("nothing.txt");
    expect((await cli(["mv", "/docs/2026/nothing.txt", "/docs/big.bin"])).code).toBe(4);
    expect((await cli(["mv", "/docs", "/docs/2026"])).code).toBe(4);
    expect((await cli(["mv", "/nope", "/docs"])).code).toBe(3);
  });

  it("search finds a file", async () => {
    const res = await cli(["search", "nothing"]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("/docs/2026/nothing.txt");
    const json = JSON.parse((await cli(["search", "BIG.bin", "--json"])).out) as {
      results: { path: string }[];
    };
    expect(json.results.map((r) => r.path)).toEqual(["/docs/big.bin"]);
    expect((await cli(["search", "zzzz-no-such-name"])).out).toContain("No matches");
    expect(
      searchResponse.parse(await (await api.bearer("/api/search?q=big")).json()).results,
    ).toHaveLength(1);
  });

  it("rm moves to the trash", async () => {
    const res = await cli(["rm", "/docs/2026/nothing.txt"]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("trash");
    const trash = trashListing.parse(await (await api.bearer("/api/trash")).json());
    expect(trash.items.map((i) => i.name)).toContain("nothing.txt");
    expect((await cli(["ls", "/docs/2026/nothing.txt"])).code).toBe(3);
    expect((await cli(["rm", "/"])).code).toBe(1);
  });

  it("share prints a link whose token works anonymously", async () => {
    const res = await cli(["share", "/docs/big.bin"]);
    expect(res.code).toBe(0);
    const link = res.out.trim();
    expect(link).toMatch(new RegExp(`^${api.base}/s/[A-Za-z0-9_-]+$`));
    const token = link.split("/s/")[1] ?? "";
    const info = await fetch(`${api.base}/api/public/shares/${token}`);
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ name: "big.bin", kind: "file", size: BIG.length });
    const content = await fetch(`${api.base}/api/public/shares/${token}/content?download=1`);
    expect(Buffer.from(await content.arrayBuffer()).equals(BIG)).toBe(true);
  });

  it("share --never --password-stdin protects the link; --json includes the share", async () => {
    const res = await cli(["share", "/docs", "--never", "--password-stdin", "--json"], {
      stdin: "a long enough password\n",
    });
    expect(res.code).toBe(0);
    const out = JSON.parse(res.out) as {
      url: string;
      share: { hasPassword: boolean; expiresAt: null };
    };
    expect(out.share).toMatchObject({ hasPassword: true, expiresAt: null });
    const token = out.url.split("/s/")[1] ?? "";
    const locked = await fetch(`${api.base}/api/public/shares/${token}/folder`);
    expect(locked.status).toBe(401);
    expect((await cli(["share", "/docs", "--password-stdin"], { stdin: "short\n" })).code).toBe(1);
  });

  it("share --drop-box needs a folder and --expires-days is validated", async () => {
    expect((await cli(["share", "/docs/big.bin", "--drop-box"])).code).toBe(1);
    expect((await cli(["share", "/docs", "--expires-days", "0"])).code).toBe(1);
    expect((await cli(["share", "/docs", "--expires-days", "3", "--never"])).code).toBe(1);
    const ok = await cli(["share", "/docs", "--drop-box", "--expires-days", "2", "--json"]);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ share: { allowUpload: true, kind: "folder" } });
  });

  it("uploads a directory tree recursively and reuses existing folders", async () => {
    const tree = join(work, "home", "photos");
    mkdirSync(join(tree, "trip", "day1"), { recursive: true });
    writeFileSync(join(tree, "cover.txt"), "cover");
    writeFileSync(join(tree, "trip", "notes.txt"), "notes");
    writeFileSync(join(tree, "trip", "day1", "a.txt"), "a");

    const refused = await cli(["upload", "photos"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("--recursive");

    const res = await cli(["upload", "photos", "--recursive", "--json"]);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.out) as { uploaded: { path: string }[] };
    expect(out.uploaded.map((u) => u.path).sort()).toEqual([
      "/photos/cover.txt",
      "/photos/trip/day1/a.txt",
      "/photos/trip/notes.txt",
    ]);

    // second run reuses the folders and keeps both files
    const again = await cli(["upload", "photos", "-r", "--json"]);
    expect(again.code).toBe(0);
    const rootNames = (await listing()).children.map((c) => c.name);
    expect(rootNames.filter((n) => n.startsWith("photos"))).toEqual(["photos"]);
    expect((await cli(["ls", "/photos/trip/day1"])).out).toMatch(/a \(1\)\.txt/);
  });

  it("missing remote and local paths exit 3", async () => {
    expect((await cli(["ls", "/no/such/place"])).code).toBe(3);
    expect((await cli(["download", "/no/such/file"])).code).toBe(3);
    const res = await cli(["upload", "does-not-exist.txt"]);
    expect(res.code).toBe(3);
    expect(res.err).toContain("does-not-exist.txt");
    expect((await cli(["upload", "small.txt", "--to", "/nowhere"])).code).toBe(3);
  });

  it("an upload over the quota exits 5", async () => {
    const member = await api.member("small@example.com");
    const quota = await api.session(`/api/admin/users/${member.id}`, {
      method: "PATCH",
      body: { quotaBytes: 1000 },
    });
    expect(quota.status).toBe(200);
    const other = makeCli({ configDir: join(work, "config-quota"), cwd: join(work, "home") });
    expect(
      (await other(["login", "--server", api.base], { env: { CLOUD_TOKEN: member.token } })).code,
    ).toBe(0);
    const res = await other(["upload", "big.bin"]);
    expect(res.code).toBe(5);
    expect(res.err).toContain("storage");
    expect((await other(["upload", "small.txt"])).code).toBe(0);
  });

  it("an unreachable server exits 10 with a plain message", async () => {
    const other = makeCli({ configDir: join(work, "config2"), cwd: join(work, "home") });
    const res = await other(["login", "--server", "http://127.0.0.1:1"], {
      env: { CLOUD_TOKEN: "cloud_x" },
    });
    expect(res.code).toBe(10);
    expect(res.err).toContain("Could not reach http://127.0.0.1:1");
  });

  it("login types the app password without echo on a terminal", async () => {
    const other = makeCli({ configDir: join(work, "config3"), cwd: join(work, "home") });
    const res = await other(["login", "--server", api.base], {
      tty: true,
      stdin: `${api.token}\n`,
    });
    expect(res.code).toBe(0);
    expect(res.out + res.err).not.toContain(api.token);
    expect(res.err).toContain("App password");
  });

  it("login reads the app password from piped stdin", async () => {
    const other = makeCli({ configDir: join(work, "config4"), cwd: join(work, "home") });
    const res = await other(["login", "--server", api.base], { stdin: `${api.token}\n` });
    expect(res.code).toBe(0);
    expect((await other(["whoami"])).code).toBe(0);
  });

  it("shows upload progress on a terminal only", async () => {
    const quiet = await cli(["upload", "small.txt", "--to", "/docs"], { chunkSize: 8 });
    expect(quiet.err).toBe("");
    const tty = await cli(["upload", "small.txt", "--to", "/docs"], {
      chunkSize: 8,
      stderrIsTty: true,
    });
    expect(tty.err).toContain("100%");
  });

  it("logout deletes the stored token", async () => {
    const res = await cli(["logout"]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("Settings");
    expect((await cli(["whoami"])).code).toBe(2);
    expect((await cli(["logout"])).out).toContain("not logged in");
    expect((await cli(["logout", "--json"])).out).toContain('"loggedOut": false');
  });
});
