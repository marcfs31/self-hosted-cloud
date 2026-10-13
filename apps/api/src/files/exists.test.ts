import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { errorResponse, existsResponse } from "@cloud/shared";
import { harness } from "../testing/harness.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("POST /api/files/exists", () => {
  it("requires a session", async () => {
    const h = harness();
    await h.admin();
    const { default: request } = await import("supertest");
    const res = await request(h.app)
      .post("/api/files/exists")
      .set("Origin", "http://localhost:3000")
      .send({ sha256s: [sha("x")] });
    expect(res.status).toBe(401);
  });

  it("reports hashes of active files, including older versions, and ignores unknown ones", async () => {
    const h = harness();
    const a = await h.admin();
    const root = (await a.root()).folder;
    const id = await a.upload(root.id, "one.txt", Buffer.from("v1"));
    await a.upload(root.id, "one.txt", Buffer.from("v2"), id);
    await a.upload(root.id, "two.txt", Buffer.from("other"));

    const res = await a.post("/api/files/exists", {
      sha256s: [sha("v1"), sha("v2"), sha("other"), sha("never uploaded"), sha("v1")],
    });
    expect(res.status).toBe(200);
    expect(existsResponse.parse(res.body).existing.sort()).toEqual(
      [sha("v1"), sha("v2"), sha("other")].sort(),
    );
  });

  it("ignores trashed files and files inside a trashed folder", async () => {
    const h = harness();
    const a = await h.admin();
    const root = (await a.root()).folder;
    const dir = await a.mkdir(root.id, "dir");
    await a.upload(dir.id, "in.txt", Buffer.from("inside"));
    const loose = await a.upload(root.id, "loose.txt", Buffer.from("loose"));
    await a.upload(root.id, "kept.txt", Buffer.from("kept"));
    const query = { sha256s: [sha("inside"), sha("loose"), sha("kept")] };

    expect(
      existsResponse.parse((await a.post("/api/files/exists", query)).body).existing,
    ).toHaveLength(3);
    expect((await a.del(`/api/files/${loose}`)).status).toBe(204);
    expect((await a.del(`/api/files/${dir.id}`)).status).toBe(204);
    expect(existsResponse.parse((await a.post("/api/files/exists", query)).body).existing).toEqual([
      sha("kept"),
    ]);
  });

  it("never reveals another user's files", async () => {
    const h = harness();
    const a = await h.admin();
    const b = await h.member("b@example.com");
    const root = (await a.root()).folder;
    await a.upload(root.id, "secret.txt", Buffer.from("secret"));
    const res = await b.post("/api/files/exists", { sha256s: [sha("secret")] });
    expect(res.status).toBe(200);
    expect(existsResponse.parse(res.body).existing).toEqual([]);
  });

  it("validates the hashes: 64 lowercase hex, 1 to 1000 entries", async () => {
    const h = harness();
    const a = await h.admin();
    const bad: object[] = [
      { sha256s: [] },
      { sha256s: ["abc"] },
      { sha256s: [sha("x").toUpperCase()] },
      { sha256s: Array.from({ length: 1001 }, (_, i) => sha(String(i))) },
      {},
    ];
    for (const body of bad) {
      const res = await a.post("/api/files/exists", body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(errorResponse.parse(res.body).error.code).toBe("invalid_request");
    }
    const max = Array.from({ length: 1000 }, (_, i) => sha(String(i)));
    expect((await a.post("/api/files/exists", { sha256s: max })).status).toBe(200);
  });
});
