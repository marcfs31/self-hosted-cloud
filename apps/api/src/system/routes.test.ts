import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createdInviteResponse, systemStatus } from "@cloud/shared";
import { createApp } from "../app.js";
import { openDatabase } from "../db/client.js";
import { TEST_SECRET_KEY } from "../testing/secret-key.js";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery";

function harness() {
  const dataDir = mkdtempSync(join(tmpdir(), "cloud-system-"));
  const app = createApp({
    config: {
      production: false,
      port: 0,
      dataDir,
      publicOrigin: ORIGIN,
      secretKey: TEST_SECRET_KEY,
    },
    version: "7.8.9",
    db: openDatabase(":memory:"),
  });
  const post = (path: string, body: object, cookie?: string) => {
    const req = request(app).post(path).set("Origin", ORIGIN);
    return (cookie ? req.set("Cookie", cookie) : req).send(body);
  };
  const cookieOf = (res: request.Response) =>
    ((res.get("Set-Cookie") ?? []).find((c) => c.startsWith("sid=")) ?? "").split(";")[0] ?? "";
  return { app, dataDir, post, cookieOf };
}

async function adminAndMember(h: ReturnType<typeof harness>) {
  const setup = await h.post("/api/auth/setup", { email: "admin@example.com", password: PASSWORD });
  const admin = h.cookieOf(setup);
  const invite = await h.post("/api/admin/invites", { role: "member" }, admin);
  const { token } = createdInviteResponse.parse(invite.body);
  const joined = await h.post("/api/auth/register", {
    token,
    email: "member@example.com",
    password: PASSWORD,
  });
  expect(joined.status).toBe(201);
  return { admin, member: h.cookieOf(joined) };
}

describe("GET /api/admin/system", () => {
  it("returns a valid SystemStatus to an admin, with host checks read from <DATA_DIR>/status", async () => {
    const h = harness();
    const { admin } = await adminAndMember(h);
    mkdirSync(join(h.dataDir, "status"));
    const checkedAt = new Date().toISOString();
    writeFileSync(
      join(h.dataDir, "status", "backup.json"),
      JSON.stringify({ ok: true, checkedAt, facts: { repositories: "2" } }),
    );
    writeFileSync(
      join(h.dataDir, "status", "health.json"),
      JSON.stringify({ ok: false, checkedAt }),
    );
    // restore-test.json is absent.

    const res = await request(h.app).get("/api/admin/system").set("Cookie", admin);
    expect(res.status).toBe(200);
    const body = systemStatus.parse(res.body);
    expect(body.version).toBe("7.8.9");
    expect(body.cpu.cores).toBeGreaterThan(0);
    expect(body.memory.availableBytes).toBeLessThanOrEqual(body.memory.totalBytes);
    expect(body.storage).not.toBeNull();
    expect(body.backup).toEqual({ state: "ok", checkedAt, facts: { repositories: "2" } });
    expect(body.health).toEqual({ state: "failing", checkedAt, facts: {} });
    expect(body.restoreTest).toEqual({ state: "unknown", checkedAt: null, facts: {} });
  });

  it("reports every host check unknown when nothing has been written yet", async () => {
    const h = harness();
    const { admin } = await adminAndMember(h);
    const res = await request(h.app).get("/api/admin/system").set("Cookie", admin);
    const body = systemStatus.parse(res.body);
    expect([body.backup.state, body.restoreTest.state, body.health.state]).toEqual([
      "unknown",
      "unknown",
      "unknown",
    ]);
  });

  it("answers 404 not_found to a non-admin, without revealing the endpoint", async () => {
    const h = harness();
    const { member } = await adminAndMember(h);
    const res = await request(h.app).get("/api/admin/system").set("Cookie", member);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found" } });
  });

  it("answers 401 to an anonymous caller", async () => {
    const h = harness();
    const res = await request(h.app).get("/api/admin/system");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "unauthenticated" } });
  });
});
