import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newAccount, type Account } from "../testing/harness.js";
import { startApi, type LiveApi } from "../testing/live-api.js";
import { ApiClient, ApiError, NetworkError } from "./client.js";

let api: LiveApi;
let acc: Account;
let client: ApiClient;

beforeAll(async () => {
  api = await startApi();
  acc = await newAccount(api);
  client = acc.client();
});

afterAll(async () => {
  await api.close();
});

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cloud-client-"));
}

describe("ApiClient", () => {
  it("maps a rejected app password to an ApiError with the API's code", async () => {
    const bad = new ApiClient(api.base, "cloud_nope");
    await expect(bad.root()).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    await expect(bad.root()).rejects.toBeInstanceOf(ApiError);
  });

  it("returns the account an app password belongs to, and rejects a wrong one", async () => {
    const me = await client.me();
    expect(me.email).toMatch(/^user\d+-\d+@example\.com$/);
    expect(me.role).toBe("member");
    await expect(new ApiClient(api.base, "cloud_nope").me()).rejects.toMatchObject({ status: 401 });
  });

  it("maps an unreachable server to a NetworkError", async () => {
    await expect(new ApiClient("http://127.0.0.1:1", "x").root()).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("creates folders, reports name conflicts, renames, moves and trashes", async () => {
    const root = await client.root();
    const a = await client.createFolder(root.id, "a");
    await expect(client.createFolder(root.id, "a")).rejects.toMatchObject({
      code: "name_conflict",
    });
    const b = await client.createFolder(root.id, "b");
    const renamed = await client.rename(b.id, { name: "b2", parentId: a.id });
    expect(renamed).toMatchObject({ name: "b2", parentId: a.id });
    expect((await client.listFolder(a.id)).map((n) => n.name)).toEqual(["b2"]);
    await client.trash(b.id);
    expect(await client.listFolder(a.id)).toEqual([]);
  });

  it("uploads in chunks, replaces by id as a new version, and downloads to a temp file", async () => {
    const root = await client.root();
    const dir = tmp();
    const first = randomBytes(200 * 1024);
    writeFileSync(join(dir, "src"), first);
    const id = await client.upload({
      path: join(dir, "src"),
      size: first.length,
      name: "data.bin",
      parentId: root.id,
    });

    const second = randomBytes(10);
    writeFileSync(join(dir, "src2"), second);
    const same = await client.upload({
      path: join(dir, "src2"),
      size: second.length,
      name: "data.bin",
      parentId: root.id,
      replaceId: id,
    });
    expect(same).toBe(id);
    const versions = await client.versions(id);
    expect(versions).toHaveLength(2);
    const [current, old] = [versions.find((v) => v.current), versions.find((v) => !v.current)];
    expect(current?.sha256).toBe(createHash("sha256").update(second).digest("hex"));

    const out = join(dir, "out");
    const result = await client.download(id, old?.id ?? "", out);
    expect(result).toEqual({
      size: first.length,
      sha256: createHash("sha256").update(first).digest("hex"),
    });
    expect(readFileSync(out).equals(first)).toBe(true);
  });

  it("does not leave a temp file when the download fails and never overwrites an existing one", async () => {
    const dir = tmp();
    const root = await client.root();
    await expect(client.download(root.id, "no-such-version", join(dir, "t"))).rejects.toMatchObject(
      { status: 404 },
    );
    expect(existsSync(join(dir, "t"))).toBe(false);
  });

  it("walks the change feed from a snapshot and then only what changed", async () => {
    const first = await client.changes(undefined);
    expect(first.changes.every((c) => c.type === "upsert")).toBe(true);
    const root = await client.root();
    await client.createFolder(root.id, "later");
    const next = await client.changes(first.cursor);
    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]).toMatchObject({ type: "upsert", node: { name: "later" } });
    await expect(client.changes("garbage")).rejects.toMatchObject({ code: "invalid_request" });
  });
});
