import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createdInviteResponse,
  errorResponse,
  listInvitesResponse,
  listUsersResponse,
  meResponse,
  user as userSchema,
} from "@cloud/shared";
import { createApp } from "../app.js";
import type { Config } from "../config.js";
import { openDatabase } from "../db/client.js";
import { invites, sessions, users } from "../db/schema/index.js";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery";
const DAY = 24 * 60 * 60 * 1000;

function harness(overrides: Partial<Config> = {}) {
  const db = openDatabase(":memory:");
  const clock = { t: Date.now() };
  const config: Config = {
    production: false,
    port: 0,
    dataDir: mkdtempSync(join(tmpdir(), "cloud-auth-")),
    publicOrigin: ORIGIN,
    ...overrides,
  };
  const app = createApp({ config, version: "0.0.0", db, now: () => clock.t });
  const post = (path: string, body?: object, cookie?: string) => {
    const req = request(app).post(path).set("Origin", ORIGIN);
    if (cookie) void req.set("Cookie", cookie);
    return body ? req.send(body) : req;
  };
  const get = (path: string, cookie?: string) => {
    const req = request(app).get(path);
    return cookie ? req.set("Cookie", cookie) : req;
  };
  return { app, db, clock, post, get };
}
type Harness = ReturnType<typeof harness>;

function setCookies(res: request.Response): string[] {
  return res.get("Set-Cookie") ?? [];
}

function sidCookie(res: request.Response): string {
  const header = setCookies(res).find((c) => c.startsWith("sid="));
  if (!header) throw new Error("no sid cookie");
  return header.split(";")[0] ?? "";
}

async function setupAdmin(h: Harness, email = "admin@example.com") {
  const res = await h.post("/api/auth/setup", { email, password: PASSWORD });
  expect(res.status).toBe(201);
  return { cookie: sidCookie(res), user: meResponse.parse(res.body).user };
}

async function inviteAndRegister(h: Harness, adminCookie: string, email: string, role = "member") {
  const created = await h.post("/api/admin/invites", { role }, adminCookie);
  const { token } = createdInviteResponse.parse(created.body);
  const res = await h.post("/api/auth/register", { token, email, password: PASSWORD });
  return { res, token };
}

describe("setup", () => {
  it("reports needsSetup, creates the first admin once, then answers 409", async () => {
    const h = harness();
    expect((await h.get("/api/auth/setup")).body).toEqual({ needsSetup: true });

    const first = await h.post("/api/auth/setup", {
      email: "Admin@Example.com",
      password: PASSWORD,
    });
    expect(first.status).toBe(201);
    const me = meResponse.parse(first.body);
    expect(me.user).toMatchObject({ email: "admin@example.com", role: "admin" });
    expect(me.user.quotaBytes).toBe(100 * 1024 ** 3);
    expect((await h.get("/api/auth/me", sidCookie(first))).status).toBe(200);
    expect((await h.get("/api/auth/setup")).body).toEqual({ needsSetup: false });

    const second = await h.post("/api/auth/setup", { email: "b@example.com", password: PASSWORD });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: { code: "setup_already_done" } });
    expect(h.db.select().from(users).all()).toHaveLength(1);
  });

  it("lets only one of two concurrent setups win", async () => {
    const h = harness();
    const results = await Promise.all([
      h.post("/api/auth/setup", { email: "a@example.com", password: PASSWORD }),
      h.post("/api/auth/setup", { email: "b@example.com", password: PASSWORD }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(h.db.select().from(users).all()).toHaveLength(1);
  });

  it("rejects short passwords and malformed JSON as invalid_request", async () => {
    const h = harness();
    const short = await h.post("/api/auth/setup", { email: "a@example.com", password: "short" });
    expect(short.status).toBe(400);
    expect(short.body).toEqual({ error: { code: "invalid_request" } });
    const malformed = await request(h.app)
      .post("/api/auth/setup")
      .set("Origin", ORIGIN)
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: { code: "invalid_request" } });
  });
});

describe("login, session and logout", () => {
  it("sets a hardened cookie on login and /me works with it", async () => {
    const h = harness();
    await setupAdmin(h);
    const res = await h.post("/api/auth/login", { email: "ADMIN@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    const header = setCookies(res).join();
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(/Max-Age=2592000/);
    expect(header).not.toMatch(/Secure/);

    const me = await h.get("/api/auth/me", sidCookie(res));
    expect(me.status).toBe(200);
    expect(userSchema.parse(meResponse.parse(me.body).user).email).toBe("admin@example.com");
  });

  it("marks the cookie Secure in production", async () => {
    const h = harness({ production: true });
    const res = await h.post("/api/auth/setup", { email: "a@example.com", password: PASSWORD });
    expect(setCookies(res).join()).toMatch(/Secure/);
  });

  it("answers wrong passwords and unknown emails with the same 401 body", async () => {
    const h = harness();
    await setupAdmin(h);
    const wrong = await h.post("/api/auth/login", { email: "admin@example.com", password: "nope" });
    const unknown = await h.post("/api/auth/login", { email: "who@example.com", password: "nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ error: { code: "invalid_credentials" } });
    expect(unknown.body).toEqual(wrong.body);
  });

  it("returns 429 after 5 failures even with the correct password, and recovers after 15 minutes", async () => {
    const h = harness();
    await setupAdmin(h);
    const creds = { email: "admin@example.com" };
    for (let i = 0; i < 5; i++) {
      expect((await h.post("/api/auth/login", { ...creds, password: "wrong" })).status).toBe(401);
    }
    const blocked = await h.post("/api/auth/login", { ...creds, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: "too_many_attempts" } });

    h.clock.t += 15 * 60 * 1000 + 1;
    expect((await h.post("/api/auth/login", { ...creds, password: PASSWORD })).status).toBe(200);
  });

  it("counts parallel wrong guesses before they finish: at most 5 get a 401, the rest 429", async () => {
    const h = harness();
    await setupAdmin(h);
    const burst = await Promise.all(
      Array.from({ length: 30 }, () =>
        h.post("/api/auth/login", { email: "admin@example.com", password: "wrong" }),
      ),
    );
    const statuses = burst.map((res) => res.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(25);
    const right = await h.post("/api/auth/login", {
      email: "admin@example.com",
      password: PASSWORD,
    });
    expect(right.status).toBe(429);
  });

  it("limits guesses per account across addresses: the 26th wrong guess is 429", async () => {
    const h = harness();
    await setupAdmin(h);
    const guess = (n: number, password = "wrong") =>
      h
        .post("/api/auth/login", { email: "admin@example.com", password })
        .set("X-Forwarded-For", `203.0.113.${String(n)}`);
    for (let n = 0; n < 25; n++) expect((await guess(n)).status).toBe(401);
    const blocked = await guess(100, PASSWORD);
    expect([blocked.status, blocked.body]).toEqual([429, { error: { code: "too_many_attempts" } }]);
    h.clock.t += 15 * 60 * 1000 + 1;
    expect((await guess(100, PASSWORD)).status).toBe(200);
  });

  it("successful sign-ins do not use up the per-account allowance", async () => {
    const h = harness();
    await setupAdmin(h);
    for (let n = 0; n < 30; n++) {
      const res = await h
        .post("/api/auth/login", { email: "admin@example.com", password: PASSWORD })
        .set("X-Forwarded-For", `198.51.100.${String(n)}`);
      expect(res.status).toBe(200);
    }
  });

  it("rejects /me without a session or with a garbage cookie", async () => {
    const h = harness();
    expect((await h.get("/api/auth/me")).body).toEqual({ error: { code: "unauthenticated" } });
    expect((await h.get("/api/auth/me", "sid=garbage")).status).toBe(401);
  });

  it("rejects an expired session with 401 and deletes its row", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    h.db
      .update(sessions)
      .set({ expiresAt: new Date(h.clock.t - 1000) })
      .run();
    const res = await h.get("/api/auth/me", cookie);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "unauthenticated" } });
    expect(h.db.select().from(sessions).all()).toHaveLength(0);
  });

  it("extends a session that has fewer than 15 days left and re-sets the cookie", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);

    h.clock.t += 10 * DAY; // 20 days left: untouched
    const early = await h.get("/api/auth/me", cookie);
    expect(early.get("Set-Cookie")).toBeUndefined();

    h.clock.t += 10 * DAY; // 10 days left: renewed
    const res = await h.get("/api/auth/me", cookie);
    expect(res.status).toBe(200);
    expect(sidCookie(res)).toBe(cookie);
    expect(setCookies(res).join()).toMatch(/Max-Age=2592000/);
    const row = h.db.select().from(sessions).get();
    expect(row?.expiresAt.getTime()).toBe(h.clock.t + 30 * DAY);
  });

  it("renewal stops at 90 days after sign-in: a session cannot be kept alive forever", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    for (const day of [20, 40, 60]) {
      h.clock.t += 20 * DAY;
      expect((await h.get("/api/auth/me", cookie)).status, `day ${String(day)}`).toBe(200);
    }
    const capped = h.db.select().from(sessions).get();
    expect(capped?.expiresAt.getTime()).toBe((capped?.createdAt.getTime() ?? 0) + 90 * DAY);

    h.clock.t += 20 * DAY; // day 80: inside the last window, nothing left to extend
    const late = await h.get("/api/auth/me", cookie);
    expect(late.status).toBe(200);
    expect(late.get("Set-Cookie")).toBeUndefined();
    h.clock.t += 11 * DAY; // day 91
    expect((await h.get("/api/auth/me", cookie)).status).toBe(401);
  });

  it("logout deletes the session row, clears the cookie and invalidates the token", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const out = await h.post("/api/auth/logout", undefined, cookie);
    expect(out.status).toBe(204);
    expect(setCookies(out).join()).toMatch(/sid=;.*Max-Age=0/);
    expect(h.db.select().from(sessions).all()).toHaveLength(0);
    expect((await h.get("/api/auth/me", cookie)).status).toBe(401);
  });
});

describe("origin check", () => {
  it("rejects a state-changing request with no Origin or a foreign Origin", async () => {
    const h = harness();
    const body = { email: "a@example.com", password: PASSWORD };
    const missing = await request(h.app).post("/api/auth/setup").send(body);
    expect(missing.status).toBe(403);
    expect(errorResponse.parse(missing.body).error.code).toBe("origin_rejected");
    const foreign = await request(h.app)
      .post("/api/auth/setup")
      .set("Origin", "http://evil.example")
      .send(body);
    expect(foreign.status).toBe(403);
    expect(foreign.body).toEqual({ error: { code: "origin_rejected" } });
    expect(h.db.select().from(users).all()).toHaveLength(0);
  });

  it("rejects the Origin check on PATCH and DELETE too", async () => {
    const h = harness();
    expect((await request(h.app).patch("/api/admin/users/x").send({})).status).toBe(403);
    expect((await request(h.app).delete("/api/admin/invites/x")).status).toBe(403);
  });

  it("lets GET through without an Origin", async () => {
    const h = harness();
    expect((await request(h.app).get("/api/auth/setup")).status).toBe(200);
    expect((await request(h.app).get("/api/health")).status).toBe(200);
  });

  it("returns a JSON 404 for unknown API routes", async () => {
    const h = harness();
    const res = await h.get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found" } });
  });
});

describe("invites and registration", () => {
  it("registers with a valid invite, gives the invite's role, and rejects reuse", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const { res, token } = await inviteAndRegister(h, admin.cookie, "Member@Example.com");
    expect(res.status).toBe(201);
    expect(meResponse.parse(res.body).user).toMatchObject({
      email: "member@example.com",
      role: "member",
      quotaBytes: 100 * 1024 ** 3,
    });
    expect((await h.get("/api/auth/me", sidCookie(res))).status).toBe(200);

    const reuse = await h.post("/api/auth/register", {
      token,
      email: "second@example.com",
      password: PASSWORD,
    });
    expect(reuse.status).toBe(404);
    expect(reuse.body).toEqual({ error: { code: "invite_invalid" } });
  });

  it("can invite another admin", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const { res } = await inviteAndRegister(h, admin.cookie, "two@example.com", "admin");
    expect(meResponse.parse(res.body).user.role).toBe("admin");
  });

  it("rejects an unknown token, an expired invite and a revoked invite", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const body = { email: "m@example.com", password: PASSWORD };

    const unknown = await h.post("/api/auth/register", { ...body, token: "nope" });
    expect(unknown.body).toEqual({ error: { code: "invite_invalid" } });

    const expiring = createdInviteResponse.parse(
      (await h.post("/api/admin/invites", { expiresInDays: 1 }, admin.cookie)).body,
    );
    h.clock.t += 2 * DAY;
    const expired = await h.post("/api/auth/register", { ...body, token: expiring.token });
    expect(expired.status).toBe(404);
    expect(expired.body).toEqual({ error: { code: "invite_invalid" } });
    h.clock.t -= 2 * DAY;

    const revocable = createdInviteResponse.parse(
      (await h.post("/api/admin/invites", {}, admin.cookie)).body,
    );
    const del = await request(h.app)
      .delete(`/api/admin/invites/${revocable.invite.id}`)
      .set("Origin", ORIGIN)
      .set("Cookie", admin.cookie);
    expect(del.status).toBe(204);
    const revoked = await h.post("/api/auth/register", { ...body, token: revocable.token });
    expect(revoked.status).toBe(404);
    expect(revoked.body).toEqual({ error: { code: "invite_invalid" } });
    expect(h.db.select().from(users).all()).toHaveLength(1);
  });

  it("answers 409 email_taken for a duplicate email and keeps the invite usable", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const created = createdInviteResponse.parse(
      (await h.post("/api/admin/invites", {}, admin.cookie)).body,
    );
    const dup = await h.post("/api/auth/register", {
      token: created.token,
      email: "ADMIN@example.com",
      password: PASSWORD,
    });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: { code: "email_taken" } });
    expect(h.db.select().from(invites).get()?.usedAt).toBeNull();

    const ok = await h.post("/api/auth/register", {
      token: created.token,
      email: "fresh@example.com",
      password: PASSWORD,
    });
    expect(ok.status).toBe(201);
  });

  it("lists invites newest first, hides revoked ones and shows usedAt", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const first = await inviteAndRegister(h, admin.cookie, "one@example.com");
    h.clock.t += 1000;
    const second = createdInviteResponse.parse(
      (await h.post("/api/admin/invites", {}, admin.cookie)).body,
    );
    const list = listInvitesResponse.parse(
      (await h.get("/api/admin/invites", admin.cookie)).body,
    ).invites;
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(second.invite.id);
    expect(list[1]?.usedAt).not.toBeNull();
    expect(first.res.status).toBe(201);

    // DELETE of a used invite is fine.
    const del = await request(h.app)
      .delete(`/api/admin/invites/${list[1]?.id ?? ""}`)
      .set("Origin", ORIGIN)
      .set("Cookie", admin.cookie);
    expect(del.status).toBe(204);
    const after = listInvitesResponse.parse(
      (await h.get("/api/admin/invites", admin.cookie)).body,
    ).invites;
    expect(after).toHaveLength(1);

    const missing = await request(h.app)
      .delete("/api/admin/invites/does-not-exist")
      .set("Origin", ORIGIN)
      .set("Cookie", admin.cookie);
    expect(missing.status).toBe(404);
  });

  it("rate-limits repeated invalid invite guesses per IP", async () => {
    const h = harness();
    const body = { token: "guess", email: "m@example.com", password: PASSWORD };
    for (let i = 0; i < 5; i++) {
      expect((await h.post("/api/auth/register", body)).status).toBe(404);
    }
    expect((await h.post("/api/auth/register", body)).status).toBe(429);
  });
});

describe("admin users", () => {
  it("hides /api/admin from members (404) and from anonymous callers (401)", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const { res } = await inviteAndRegister(h, admin.cookie, "m@example.com");
    const member = sidCookie(res);
    for (const path of ["/api/admin/users", "/api/admin/invites"]) {
      const denied = await h.get(path, member);
      expect(denied.status).toBe(404);
      expect(denied.body).toEqual({ error: { code: "not_found" } });
      expect((await h.get(path)).status).toBe(401);
    }
    expect((await h.post("/api/admin/invites", {}, member)).status).toBe(404);
  });

  it("lists users oldest first and patches quota and role of another user", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    h.clock.t += 1000;
    const { res } = await inviteAndRegister(h, admin.cookie, "m@example.com");
    const memberId = meResponse.parse(res.body).user.id;

    const list = listUsersResponse.parse((await h.get("/api/admin/users", admin.cookie)).body);
    expect(list.users.map((u) => u.email)).toEqual(["admin@example.com", "m@example.com"]);

    const patch = await request(h.app)
      .patch(`/api/admin/users/${memberId}`)
      .set("Origin", ORIGIN)
      .set("Cookie", admin.cookie)
      .send({ quotaBytes: 5, role: "admin" });
    expect(patch.status).toBe(200);
    expect(userSchema.parse(patch.body)).toMatchObject({
      id: memberId,
      quotaBytes: 5,
      role: "admin",
    });
  });

  it("answers 409 on self, 404 on an unknown id and 400 on an empty patch", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const patch = (id: string, body: object) =>
      request(h.app)
        .patch(`/api/admin/users/${id}`)
        .set("Origin", ORIGIN)
        .set("Cookie", admin.cookie)
        .send(body);
    const self = await patch(admin.user.id, { quotaBytes: 1 });
    expect(self.status).toBe(409);
    expect(self.body).toEqual({ error: { code: "cannot_change_self" } });
    expect((await patch("unknown", { quotaBytes: 1 })).status).toBe(404);
    expect((await patch("unknown", {})).status).toBe(400);
  });
});

describe("secrets at rest", () => {
  it("never stores raw session or invite tokens, and hashes passwords with Argon2id", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const created = createdInviteResponse.parse(
      (await h.post("/api/admin/invites", {}, admin.cookie)).body,
    );
    const reg = await h.post("/api/auth/register", {
      token: created.token,
      email: "m@example.com",
      password: PASSWORD,
    });
    const login = await h.post("/api/auth/login", {
      email: "admin@example.com",
      password: PASSWORD,
    });
    const rawTokens = [admin.cookie, sidCookie(reg), sidCookie(login)].map((c) => c.slice(4));
    rawTokens.push(created.token);

    const dump = JSON.stringify(
      ["users", "sessions", "invites"].map((t) => h.db.$client.prepare(`select * from ${t}`).all()),
    );
    for (const token of rawTokens) {
      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(dump).not.toContain(token);
    }
    expect(dump).not.toContain(PASSWORD);
    for (const row of h.db.select().from(users).all()) {
      expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    }
    expect(
      h.db.select().from(sessions).where(eq(sessions.userId, admin.user.id)).all(),
    ).toHaveLength(2);
  });
});
