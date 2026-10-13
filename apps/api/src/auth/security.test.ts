import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  activityPage,
  createdAppPasswordResponse,
  createdInviteResponse,
  meResponse,
  recoveryCodesResponse,
  totpSetupResponse,
  totpStatus,
  appPasswordList,
  type ActivityPage,
} from "@cloud/shared";
import { recordActivity } from "../activity/record.js";
import { createApp } from "../app.js";
import type { Config } from "../config.js";
import { TEST_SECRET_KEY } from "../testing/secret-key.js";
import { openDatabase } from "../db/client.js";
import {
  activity,
  appPasswords,
  recoveryCodes,
  sessions,
  totp,
  users,
} from "../db/schema/index.js";
import { sealLegacyTotpSecrets } from "./secret-box.js";
import { hashToken } from "./tokens.js";
import { totpAt } from "./totp.js";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery";
const STEP_MS = 30_000;

function harness() {
  const db = openDatabase(":memory:");
  const clock = { t: Date.UTC(2026, 9, 13, 12, 0, 0) };
  const config: Config = {
    production: false,
    port: 0,
    dataDir: mkdtempSync(join(tmpdir(), "cloud-security-")),
    publicOrigin: ORIGIN,
    secretKey: TEST_SECRET_KEY,
  };
  const app = createApp({ config, version: "0.0.0", db, now: () => clock.t });
  type Auth = { cookie?: string; bearer?: string };
  const withAuth = (req: request.Test, auth: Auth) => {
    if (auth.cookie) void req.set("Cookie", auth.cookie);
    if (auth.bearer) void req.set("Authorization", `Bearer ${auth.bearer}`);
    return req;
  };
  const post = (path: string, body?: object, auth: Auth = {}) => {
    const req = withAuth(request(app).post(path).set("Origin", ORIGIN), auth);
    return body ? req.send(body) : req;
  };
  const get = (path: string, auth: Auth = {}) => withAuth(request(app).get(path), auth);
  const del = (path: string, auth: Auth = {}) =>
    withAuth(request(app).delete(path).set("Origin", ORIGIN), auth);
  return { app, db, clock, post, get, del };
}
type Harness = ReturnType<typeof harness>;

function sidCookie(res: request.Response): string {
  const header = (res.get("Set-Cookie") ?? []).find((c) => c.startsWith("sid="));
  if (!header) throw new Error("no sid cookie");
  return header.split(";")[0] ?? "";
}

async function setupAdmin(h: Harness) {
  const res = await h.post("/api/auth/setup", { email: "admin@example.com", password: PASSWORD });
  expect(res.status).toBe(201);
  return { cookie: sidCookie(res), user: meResponse.parse(res.body).user };
}

async function addMember(h: Harness, adminCookie: string, email = "member@example.com") {
  const invite = createdInviteResponse.parse(
    (await h.post("/api/admin/invites", { role: "member" }, { cookie: adminCookie })).body,
  );
  const res = await h.post("/api/auth/register", {
    token: invite.token,
    email,
    password: PASSWORD,
  });
  expect(res.status).toBe(201);
  return { cookie: sidCookie(res), user: meResponse.parse(res.body).user };
}

/** Runs setup + enable for the session and returns the secret and the recovery codes. */
async function enableTotp(h: Harness, cookie: string) {
  const setup = totpSetupResponse.parse(
    (await h.post("/api/auth/totp/setup", {}, { cookie })).body,
  );
  const res = await h.post(
    "/api/auth/totp/enable",
    { code: totpAt(setup.secret, h.clock.t) },
    { cookie },
  );
  expect(res.status).toBe(200);
  return {
    secret: setup.secret,
    recoveryCodes: recoveryCodesResponse.parse(res.body).recoveryCodes,
  };
}

async function loginPending(h: Harness, email = "admin@example.com") {
  const res = await h.post("/api/auth/login", { email, password: PASSWORD });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ mfaRequired: true });
  return sidCookie(res);
}

async function feed(h: Harness, path: string, auth: { cookie: string }): Promise<ActivityPage> {
  const res = await h.get(path, auth);
  expect(res.status).toBe(200);
  return activityPage.parse(res.body);
}

describe("TOTP enrolment", () => {
  it("sets up, rejects a wrong code, enables with a right one and hands out 10 hashed recovery codes", async () => {
    const h = harness();
    const { cookie, user } = await setupAdmin(h);
    expect((await h.get("/api/auth/totp", { cookie })).body).toEqual({
      enabled: false,
      recoveryCodesLeft: 0,
    });

    const setup = totpSetupResponse.parse(
      (await h.post("/api/auth/totp/setup", {}, { cookie })).body,
    );
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toBe(
      `otpauth://totp/Cloud:admin%40example.com?secret=${setup.secret}&issuer=Cloud`,
    );
    // Not enabled until confirmed, so a login is still password-only.
    expect(h.db.select().from(totp).get()?.enabledAt).toBeNull();

    const wrong = await h.post("/api/auth/totp/enable", { code: "000000" }, { cookie });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ error: { code: "invalid_code" } });

    const ok = await h.post(
      "/api/auth/totp/enable",
      { code: totpAt(setup.secret, h.clock.t) },
      { cookie },
    );
    expect(ok.status).toBe(200);
    const { recoveryCodes: codes } = recoveryCodesResponse.parse(ok.body);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

    const stored = h.db.select().from(recoveryCodes).all();
    expect(stored).toHaveLength(10);
    for (const row of stored) {
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(codes).not.toContain(row.codeHash);
      expect(row.usedAt).toBeNull();
    }
    expect(totpStatus.parse((await h.get("/api/auth/totp", { cookie })).body)).toEqual({
      enabled: true,
      recoveryCodesLeft: 10,
    });

    // Setting up again while enabled is refused; enabling twice too.
    expect((await h.post("/api/auth/totp/setup", {}, { cookie })).status).toBe(409);
    const again = await h.post(
      "/api/auth/totp/enable",
      { code: totpAt(setup.secret, h.clock.t + STEP_MS) },
      { cookie },
    );
    expect(again.status).toBe(409);

    const events = (await feed(h, "/api/activity", { cookie })).events;
    expect(events.map((e) => e.type)).toContain("totp_enabled");
    expect(JSON.stringify(events)).not.toContain(setup.secret);
    expect(h.db.select().from(users).where(eq(users.id, user.id)).get()).toBeDefined();
  });

  it("restarting setup replaces a pending secret", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const first = totpSetupResponse.parse(
      (await h.post("/api/auth/totp/setup", {}, { cookie })).body,
    );
    const second = totpSetupResponse.parse(
      (await h.post("/api/auth/totp/setup", {}, { cookie })).body,
    );
    expect(second.secret).not.toBe(first.secret);
    const stale = await h.post(
      "/api/auth/totp/enable",
      { code: totpAt(first.secret, h.clock.t) },
      { cookie },
    );
    expect(stale.status).toBe(400);
  });

  it("enable without setup answers 409", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    expect((await h.post("/api/auth/totp/enable", { code: "123456" }, { cookie })).status).toBe(
      409,
    );
  });
});

describe("login with a second factor", () => {
  async function enrolled() {
    const h = harness();
    const admin = await setupAdmin(h);
    const factor = await enableTotp(h, admin.cookie);
    h.clock.t += STEP_MS; // the enrolment code's step is spent
    return { h, admin, ...factor };
  }

  it("a pending session reaches nothing but /login/totp, /logout and a 401 /me", async () => {
    const { h } = await enrolled();
    const pending = await loginPending(h);
    const auth = { cookie: pending };
    const mfaRequired = { error: { code: "mfa_required" } };

    for (const path of [
      "/api/auth/me",
      "/api/admin/users",
      "/api/admin/activity",
      "/api/auth/app-passwords",
      "/api/auth/passkeys",
      "/api/auth/totp",
      "/api/activity",
    ]) {
      const res = await h.get(path, auth);
      expect(res.status, path).toBe(401);
      expect(res.body, path).toEqual(mfaRequired);
    }
    for (const path of [
      "/api/auth/app-passwords",
      "/api/auth/totp/setup",
      "/api/auth/passkeys/register/options",
      "/api/auth/password",
    ]) {
      const res = await h.post(path, { name: "x" }, auth);
      expect(res.status, path).toBe(401);
      expect(res.body, path).toEqual(mfaRequired);
    }
    expect(h.db.select().from(sessions).where(eq(sessions.mfaPending, true)).all()).toHaveLength(1);
  });

  it("the right code yields a full session with a NEW cookie, and the old token dies", async () => {
    const { h, secret } = await enrolled();
    const pending = await loginPending(h);

    const res = await h.post(
      "/api/auth/login/totp",
      { code: totpAt(secret, h.clock.t) },
      { cookie: pending },
    );
    expect(res.status).toBe(200);
    expect(meResponse.parse(res.body).user.email).toBe("admin@example.com");
    const full = sidCookie(res);
    expect(full).not.toBe(pending);
    expect(res.get("Set-Cookie")?.join()).toMatch(/HttpOnly/);

    expect((await h.get("/api/auth/me", { cookie: pending })).body).toEqual({
      error: { code: "unauthenticated" },
    });
    expect((await h.get("/api/auth/me", { cookie: full })).status).toBe(200);
    expect((await h.get("/api/admin/users", { cookie: full })).status).toBe(200);
    expect(h.db.select().from(sessions).where(eq(sessions.mfaPending, true)).all()).toHaveLength(0);
  });

  it("rejects a replayed code, even one from the previous step", async () => {
    const { h, secret } = await enrolled();
    const code = totpAt(secret, h.clock.t);
    const first = await h.post("/api/auth/login/totp", { code }, { cookie: await loginPending(h) });
    expect(first.status).toBe(200);

    const replay = await h.post(
      "/api/auth/login/totp",
      { code },
      { cookie: await loginPending(h) },
    );
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ error: { code: "invalid_code" } });

    // The previous step is inside the window but older than the spent one.
    const older = await h.post(
      "/api/auth/login/totp",
      { code: totpAt(secret, h.clock.t - STEP_MS) },
      { cookie: await loginPending(h) },
    );
    expect(older.status).toBe(401);

    // The next step is still fine.
    h.clock.t += STEP_MS;
    const next = await h.post(
      "/api/auth/login/totp",
      { code: totpAt(secret, h.clock.t) },
      { cookie: await loginPending(h) },
    );
    expect(next.status).toBe(200);
  });

  it("a recovery code works once, in any case or spacing", async () => {
    const { h, recoveryCodes: codes } = await enrolled();
    const code = codes[0] ?? "";
    const res = await h.post(
      "/api/auth/login/totp",
      { code: code.toLowerCase() },
      { cookie: await loginPending(h) },
    );
    expect(res.status).toBe(200);

    const reuse = await h.post("/api/auth/login/totp", { code }, { cookie: await loginPending(h) });
    expect(reuse.status).toBe(401);
    expect(reuse.body).toEqual({ error: { code: "invalid_code" } });

    const other = await h.post(
      "/api/auth/login/totp",
      { code: (codes[1] ?? "").replace("-", " ") },
      { cookie: await loginPending(h) },
    );
    expect(other.status).toBe(200);
    expect(
      totpStatus.parse((await h.get("/api/auth/totp", { cookie: sidCookie(other) })).body),
    ).toMatchObject({ recoveryCodesLeft: 8 });
  });

  it("limits wrong guesses to 5 per user and then answers 429, even for a right code", async () => {
    const { h, secret } = await enrolled();
    const pending = await loginPending(h);
    for (let i = 0; i < 5; i++) {
      const res = await h.post("/api/auth/login/totp", { code: "000000" }, { cookie: pending });
      expect(res.status).toBe(401);
    }
    const blocked = await h.post(
      "/api/auth/login/totp",
      { code: totpAt(secret, h.clock.t) },
      { cookie: pending },
    );
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: "too_many_attempts" } });
    h.clock.t += 15 * 60 * 1000 + 1;
    const fresh = await loginPending(h);
    const ok = await h.post(
      "/api/auth/login/totp",
      { code: totpAt(secret, h.clock.t) },
      { cookie: fresh },
    );
    expect(ok.status).toBe(200);
  });

  it("a pending session expires after 10 minutes and can log out", async () => {
    const { h, secret } = await enrolled();
    const pending = await loginPending(h);
    expect((await h.post("/api/auth/logout", undefined, { cookie: pending })).status).toBe(204);
    expect(h.db.select().from(sessions).where(eq(sessions.mfaPending, true)).all()).toHaveLength(0);

    const second = await loginPending(h);
    h.clock.t += 10 * 60 * 1000 + 1;
    const late = await h.post(
      "/api/auth/login/totp",
      { code: totpAt(secret, h.clock.t) },
      { cookie: second },
    );
    expect(late.status).toBe(401);
    expect(late.body).toEqual({ error: { code: "unauthenticated" } });
  });

  it("/login/totp on a full session is refused", async () => {
    const { h, admin } = await enrolled();
    const res = await h.post("/api/auth/login/totp", { code: "123456" }, { cookie: admin.cookie });
    expect(res.status).toBe(400);
  });

  it("counts parallel disable attempts before the password check finishes: at most 5 get a 401", async () => {
    const { h, admin } = await enrolled();
    const burst = await Promise.all(
      Array.from({ length: 20 }, () =>
        h.post(
          "/api/auth/totp/disable",
          { password: "wrong", code: "000000" },
          { cookie: admin.cookie },
        ),
      ),
    );
    const statuses = burst.map((res) => res.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });

  it("disabling needs the password and a current code", async () => {
    const { h, admin, secret } = await enrolled();
    const cookie = admin.cookie;
    const code = totpAt(secret, h.clock.t);

    const badPassword = await h.post(
      "/api/auth/totp/disable",
      { password: "nope", code },
      { cookie },
    );
    expect(badPassword.status).toBe(401);
    expect(badPassword.body).toEqual({ error: { code: "invalid_credentials" } });
    const badCode = await h.post(
      "/api/auth/totp/disable",
      { password: PASSWORD, code: "000000" },
      { cookie },
    );
    expect(badCode.status).toBe(400);
    expect(badCode.body).toEqual({ error: { code: "invalid_code" } });
    expect(totpStatus.parse((await h.get("/api/auth/totp", { cookie })).body).enabled).toBe(true);

    const ok = await h.post("/api/auth/totp/disable", { password: PASSWORD, code }, { cookie });
    expect(ok.status).toBe(204);
    expect(totpStatus.parse((await h.get("/api/auth/totp", { cookie })).body)).toEqual({
      enabled: false,
      recoveryCodesLeft: 0,
    });
    expect(h.db.select().from(totp).all()).toHaveLength(0);
    // Password login is direct again.
    const login = await h.post("/api/auth/login", {
      email: "admin@example.com",
      password: PASSWORD,
    });
    expect(meResponse.parse(login.body).user.role).toBe("admin");
    const types = (await feed(h, "/api/activity", { cookie })).events.map((e) => e.type);
    expect(types).toContain("totp_disabled");
  });
});

describe("admin reset of a second factor", () => {
  it("clears TOTP and recovery codes of another user, refuses self, unknown ids and non-admins", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const member = await addMember(h, admin.cookie);
    await enableTotp(h, member.cookie);
    h.clock.t += STEP_MS;
    await loginPending(h, "member@example.com");

    const self = await h.post(
      `/api/admin/users/${admin.user.id}/reset-mfa`,
      {},
      { cookie: admin.cookie },
    );
    expect(self.status).toBe(409);
    expect(self.body).toEqual({ error: { code: "cannot_change_self" } });
    const unknown = await h.post("/api/admin/users/nope/reset-mfa", {}, { cookie: admin.cookie });
    expect(unknown.status).toBe(404);
    const byMember = await h.post(
      `/api/admin/users/${admin.user.id}/reset-mfa`,
      {},
      { cookie: member.cookie },
    );
    expect(byMember.status).toBe(404);
    expect(h.db.select().from(totp).all()).toHaveLength(1);

    h.clock.t += 1000;
    const ok = await h.post(
      `/api/admin/users/${member.user.id}/reset-mfa`,
      {},
      { cookie: admin.cookie },
    );
    expect(ok.status).toBe(204);
    expect(h.db.select().from(totp).all()).toHaveLength(0);
    expect(h.db.select().from(recoveryCodes).all()).toHaveLength(0);

    const login = await h.post("/api/auth/login", {
      email: "member@example.com",
      password: PASSWORD,
    });
    expect(meResponse.parse(login.body).user.email).toBe("member@example.com");

    const own = await feed(h, "/api/activity", { cookie: sidCookie(login) });
    expect(own.events.find((e) => e.type === "mfa_reset_by_admin")?.detail).toEqual({
      by: "admin@example.com",
    });
    const adminFeed = await feed(h, "/api/admin/activity", { cookie: admin.cookie });
    expect(adminFeed.events.find((e) => e.type === "mfa_reset_by_admin")?.userEmail).toBe(
      "member@example.com",
    );
  });
});

describe("session revocation", () => {
  async function secondSession(h: Harness, email = "admin@example.com") {
    const res = await h.post("/api/auth/login", { email, password: PASSWORD });
    expect(res.status).toBe(200);
    return sidCookie(res);
  }
  const status = async (h: Harness, cookie: string) =>
    (await h.get("/api/auth/me", { cookie })).status;

  it("enabling TOTP ends the other sessions of the user and keeps the caller's", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const stolen = await secondSession(h);
    expect(await status(h, stolen)).toBe(200);
    await enableTotp(h, admin.cookie);
    expect(await status(h, stolen)).toBe(401);
    expect(await status(h, admin.cookie)).toBe(200);
  });

  it("disabling TOTP ends the other sessions of the user", async () => {
    const { h, admin, secret } = await (async () => {
      const h = harness();
      const admin = await setupAdmin(h);
      const factor = await enableTotp(h, admin.cookie);
      h.clock.t += STEP_MS;
      return { h, admin, ...factor };
    })();
    const login = await h.post("/api/auth/login", {
      email: "admin@example.com",
      password: PASSWORD,
    });
    const pending = sidCookie(login);
    const done = await h.post(
      "/api/auth/login/totp",
      { code: totpAt(secret, h.clock.t) },
      { cookie: pending },
    );
    const other = sidCookie(done);
    expect(await status(h, other)).toBe(200);
    h.clock.t += STEP_MS;
    const off = await h.post(
      "/api/auth/totp/disable",
      { password: PASSWORD, code: totpAt(secret, h.clock.t) },
      { cookie: admin.cookie },
    );
    expect(off.status).toBe(204);
    expect(await status(h, other)).toBe(401);
    expect(await status(h, admin.cookie)).toBe(200);
  });

  it("an admin reset of the second factor ends every session of that user", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const member = await addMember(h, admin.cookie);
    const second = await secondSession(h, "member@example.com");
    const reset = await h.post(
      `/api/admin/users/${member.user.id}/reset-mfa`,
      {},
      { cookie: admin.cookie },
    );
    expect(reset.status).toBe(204);
    expect(await status(h, member.cookie)).toBe(401);
    expect(await status(h, second)).toBe(401);
    expect(await status(h, admin.cookie)).toBe(200);
  });

  it("POST /sessions/revoke-others keeps the caller's session and nobody else's survives", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const member = await addMember(h, admin.cookie);
    const other = await secondSession(h);
    const out = await h.post("/api/auth/sessions/revoke-others", {}, { cookie: admin.cookie });
    expect(out.status).toBe(204);
    expect(await status(h, other)).toBe(401);
    expect(await status(h, admin.cookie)).toBe(200);
    expect(await status(h, member.cookie)).toBe(200);
    expect((await h.post("/api/auth/sessions/revoke-others", {})).status).toBe(401);
  });
});

describe("app passwords", () => {
  async function withToken(h: Harness, cookie: string, name = "laptop") {
    const res = await h.post("/api/auth/app-passwords", { name, password: PASSWORD }, { cookie });
    expect(res.status).toBe(201);
    return createdAppPasswordResponse.parse(res.body);
  }

  it("shows the token once, stores only its hash and lists without it", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const created = await withToken(h, cookie);
    expect(created.token).toMatch(/^cloud_[A-Za-z0-9_-]{43}$/);
    expect(created.appPassword).toMatchObject({ name: "laptop", lastUsedAt: null });

    const row = h.db.select().from(appPasswords).get();
    expect(row?.tokenHash).toBe(hashToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);

    const list = await h.get("/api/auth/app-passwords", { cookie });
    expect(appPasswordList.parse(list.body).appPasswords).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(created.token);
    expect(JSON.stringify(list.body)).not.toContain("tokenHash");
  });

  it("authenticates a Bearer request as the user and ignores any cookie", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const member = await addMember(h, admin.cookie);
    const { token } = await withToken(h, member.cookie);

    const me = await h.get("/api/auth/me", { bearer: token });
    expect(meResponse.parse(me.body).user.email).toBe("member@example.com");
    expect((await h.get("/api/activity", { bearer: token })).status).toBe(200);
    // Bearer wins: the admin's cookie must not turn this into an admin request.
    const both = await h.get("/api/auth/me", { bearer: token, cookie: admin.cookie });
    expect(meResponse.parse(both.body).user.email).toBe("member@example.com");
    // A bad Bearer is a 401 even next to a perfectly good cookie.
    const bad = await h.get("/api/auth/me", { bearer: "cloud_nope", cookie: admin.cookie });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ error: { code: "unauthenticated" } });
    expect((await h.get("/api/auth/me", { bearer: "" })).status).toBe(401);
  });

  it("cannot reach /auth/* (except GET /auth/me) or /admin/*: those answer 404", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const { token } = await withToken(h, admin.cookie);
    const notFound = { error: { code: "not_found" } };
    const auth = { bearer: token };

    for (const path of [
      "/api/auth/app-passwords",
      "/api/auth/passkeys",
      "/api/auth/totp",
      "/api/admin/users",
      "/api/admin/activity",
      "/api/admin/invites",
    ]) {
      const res = await h.get(path, auth);
      expect(res.status, path).toBe(404);
      expect(res.body, path).toEqual(notFound);
    }
    for (const path of [
      "/api/auth/app-passwords",
      "/api/auth/totp/disable",
      "/api/auth/totp/setup",
      "/api/auth/logout",
      "/api/auth/login",
      "/api/auth/passkeys/register/options",
      "/api/admin/invites",
    ]) {
      const res = await h.post(path, { name: "x" }, auth);
      expect(res.status, path).toBe(404);
      expect(res.body, path).toEqual(notFound);
    }
    expect((await h.del("/api/auth/app-passwords/x", auth)).status).toBe(404);
    expect((await h.get("/api/auth/ME/", auth)).status).toBe(200);
    // The 404 does not depend on the token being valid.
    expect((await h.get("/api/admin/users", { bearer: "cloud_nope" })).status).toBe(404);
    // And nothing was changed by those attempts.
    expect(h.db.select().from(appPasswords).all()).toHaveLength(1);
    expect(h.db.select().from(sessions).all()).toHaveLength(1);
  });

  it("skips the Origin check only for Bearer requests", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const { token } = await withToken(h, cookie);

    // No Origin header at all: the Bearer request gets past the CSRF check (and then 404s on
    // the unknown route) instead of a 403.
    const bearer = await request(h.app)
      .post("/api/nothing-here")
      .set("Authorization", `Bearer ${token}`);
    expect(bearer.status).toBe(404);
    // The same without Bearer, or with another scheme, is refused.
    expect((await request(h.app).post("/api/nothing-here")).status).toBe(403);
    const basic = await request(h.app)
      .post("/api/nothing-here")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(basic.status).toBe(403);
    // A cookie alone never earns the exemption.
    const cookieOnly = await request(h.app).post("/api/nothing-here").set("Cookie", cookie);
    expect(cookieOnly.status).toBe(403);
  });

  it("revoking makes the token a 401, and only the owner can revoke", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const member = await addMember(h, admin.cookie);
    const created = await withToken(h, member.cookie);

    const foreign = await h.del(`/api/auth/app-passwords/${created.appPassword.id}`, {
      cookie: admin.cookie,
    });
    expect(foreign.status).toBe(404);
    expect((await h.get("/api/auth/me", { bearer: created.token })).status).toBe(200);

    const ok = await h.del(`/api/auth/app-passwords/${created.appPassword.id}`, {
      cookie: member.cookie,
    });
    expect(ok.status).toBe(204);
    const revoked = await h.get("/api/auth/me", { bearer: created.token });
    expect(revoked.status).toBe(401);
    expect(revoked.body).toEqual({ error: { code: "unauthenticated" } });
    expect((await h.get("/api/activity", { bearer: created.token })).status).toBe(401);
  });

  it("updates lastUsedAt at most once a minute", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const { token, appPassword } = await withToken(h, cookie);
    const lastUsed = () =>
      h.db.select().from(appPasswords).where(eq(appPasswords.id, appPassword.id)).get()?.lastUsedAt;
    expect(lastUsed()).toBeNull();

    const first = h.clock.t;
    await h.get("/api/auth/me", { bearer: token });
    expect(lastUsed()?.getTime()).toBe(first);
    h.clock.t += 30_000;
    await h.get("/api/auth/me", { bearer: token });
    expect(lastUsed()?.getTime()).toBe(first);
    h.clock.t += 31_000;
    await h.get("/api/auth/me", { bearer: token });
    expect(lastUsed()?.getTime()).toBe(h.clock.t);

    const list = appPasswordList.parse((await h.get("/api/auth/app-passwords", { cookie })).body);
    expect(list.appPasswords[0]?.lastUsedAt).toBe(new Date(h.clock.t).toISOString());
  });
});

describe("activity log", () => {
  it("records sign-ins, failures of known emails only, logout and security changes", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const tick = () => (h.clock.t += 1000);

    tick();
    await h.post("/api/auth/login", { email: "who@example.com", password: "wrong" });
    tick();
    await h.post("/api/auth/login", { email: "admin@example.com", password: "wrong" });
    tick();
    const login = await h.post("/api/auth/login", {
      email: "admin@example.com",
      password: PASSWORD,
    });
    const cookie = sidCookie(login);
    tick();
    const created = await h.post(
      "/api/auth/app-passwords",
      { name: "cli", password: PASSWORD },
      { cookie },
    );
    const parsed = createdAppPasswordResponse.parse(created.body);
    tick();
    await h.del(`/api/auth/app-passwords/${parsed.appPassword.id}`, { cookie });
    tick();
    const { secret } = await enableTotp(h, cookie);
    tick();
    await h.post("/api/auth/logout", undefined, { cookie });

    const again = await h.post("/api/auth/login", {
      email: "admin@example.com",
      password: PASSWORD,
    });
    expect(again.body).toEqual({ mfaRequired: true });
    h.clock.t += STEP_MS;
    const full = await h.post(
      "/api/auth/login/totp",
      { code: totpAt(secret, h.clock.t) },
      { cookie: sidCookie(again) },
    );
    expect(full.status).toBe(200);

    const page = await feed(h, "/api/activity", { cookie: sidCookie(full) });
    expect(page.events.map((e) => e.type)).toEqual([
      "login_succeeded", // after the code
      "logout",
      "totp_enabled",
      "app_password_revoked",
      "app_password_created",
      "login_succeeded",
      "login_failed",
    ]);
    expect(page.events[0]?.detail).toEqual({ method: "totp" });
    expect(page.events.at(-2)?.detail).toEqual({ method: "password" });
    expect(page.events.find((e) => e.type === "app_password_created")?.detail).toEqual({
      name: "cli",
    });
    expect(page.events.every((e) => e.userEmail === null && e.fileId === null)).toBe(true);
    expect(page.events[0]?.ip).toEqual(expect.any(String));
    // Unknown emails are not recorded; the one failure above belongs to the admin.
    expect(h.db.select().from(activity).all()).toHaveLength(7);

    const text = JSON.stringify(page);
    expect(text).not.toContain(parsed.token);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(PASSWORD);
    expect(admin.user.id).toBeTruthy();
  });

  it("records a failed second factor against the user", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    await enableTotp(h, cookie);
    h.clock.t += STEP_MS;
    const pending = await loginPending(h);
    await h.post("/api/auth/login/totp", { code: "000000" }, { cookie: pending });
    const row = h.db
      .select()
      .from(activity)
      .all()
      .find((r) => r.type === "login_failed");
    expect(JSON.parse(row?.detail ?? "{}")).toEqual({ method: "totp" });
  });

  it("paginates newest first with an opaque cursor and no gaps or repeats", async () => {
    const h = harness();
    const { cookie, user } = await setupAdmin(h);
    // 7 events; the middle three share a timestamp to exercise the id tie-break.
    const times = [1, 2, 3, 3, 3, 4, 5].map((n) => h.clock.t + n * 1000);
    for (const at of times) {
      recordActivity(h.db, { userId: user.id, type: "login_succeeded", at });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `?limit=3&cursor=${cursor}` : "?limit=3";
      const page: ActivityPage = await feed(h, `/api/activity${query}`, { cookie });
      expect(page.events.length).toBeLessThanOrEqual(3);
      seen.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);

    const all = (await feed(h, "/api/activity?limit=200", { cookie })).events;
    expect(all.map((e) => e.id)).toEqual(seen);
    const stamps = all.map((e) => Date.parse(e.createdAt));
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
    expect((await feed(h, "/api/activity?limit=7", { cookie })).nextCursor).toBeNull();

    expect((await h.get("/api/activity?cursor=%21%21", { cookie })).status).toBe(400);
    expect((await h.get("/api/activity?limit=0", { cookie })).status).toBe(400);
    expect((await h.get("/api/activity?limit=500", { cookie })).status).toBe(400);
  });

  it("shows each user only their own events", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const member = await addMember(h, admin.cookie);
    recordActivity(h.db, {
      userId: admin.user.id,
      type: "upload",
      fileId: "f1",
      detail: { name: "a.txt" },
    });
    recordActivity(h.db, { userId: member.user.id, type: "trash", fileId: "f2" });
    const mine = await feed(h, "/api/activity", { cookie: member.cookie });
    expect(mine.events.map((e) => e.type)).toEqual(["trash"]);
    expect(mine.events[0]?.fileId).toBe("f2");
    expect((await h.get("/api/activity")).status).toBe(401);
  });

  it("gives admins the security events of everyone with emails, and members a 404", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const member = await addMember(h, admin.cookie);
    h.clock.t += 1000;
    await h.post("/api/auth/login", { email: "member@example.com", password: "wrong" });
    h.clock.t += 1000;
    const login = await h.post("/api/auth/login", {
      email: "member@example.com",
      password: PASSWORD,
    });
    h.clock.t += 1000;
    await h.post("/api/auth/logout", undefined, { cookie: sidCookie(login) });
    recordActivity(h.db, {
      userId: member.user.id,
      type: "upload",
      fileId: "f1",
      at: h.clock.t + 1,
    });

    const adminFeed = await feed(h, "/api/admin/activity", { cookie: admin.cookie });
    expect(adminFeed.events.map((e) => [e.type, e.userEmail])).toEqual([
      ["login_succeeded", "member@example.com"],
      ["login_failed", "member@example.com"],
    ]);
    // Logout and file events stay in the owner's own feed only.
    const own = await feed(h, "/api/activity", { cookie: member.cookie });
    expect(own.events.map((e) => e.type)).toEqual([
      "upload",
      "logout",
      "login_succeeded",
      "login_failed",
    ]);

    const denied = await h.get("/api/admin/activity", { cookie: member.cookie });
    expect(denied.status).toBe(404);
    expect(denied.body).toEqual({ error: { code: "not_found" } });
  });

  it("recordActivity rolls back with its transaction", () => {
    const h = harness();
    const id = crypto.randomUUID();
    h.db
      .insert(users)
      .values({
        id,
        email: "a@example.com",
        passwordHash: "x",
        role: "member",
        quotaBytes: 0,
        createdAt: new Date(),
      })
      .run();
    expect(() =>
      h.db.transaction((tx) => {
        recordActivity(tx, { userId: id, type: "upload" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(h.db.select().from(activity).all()).toHaveLength(0);
  });

  it("removes a user's events with the user", async () => {
    const h = harness();
    const { user } = await setupAdmin(h);
    recordActivity(h.db, { userId: user.id, type: "upload", fileId: "gone" });
    h.db.delete(users).where(eq(users.id, user.id)).run();
    expect(h.db.select().from(activity).all()).toHaveLength(0);
  });
});

describe("app passwords: step-up re-authentication", () => {
  const create = (h: Harness, cookie: string, extra: object = {}) =>
    h.post("/api/auth/app-passwords", { name: "laptop", ...extra }, { cookie });
  const rows = (h: Harness) => h.db.select().from(appPasswords).all();

  it("refuses a request without the password, with a wrong one, and creates nothing", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const missing = await create(h, cookie);
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ error: { code: "invalid_request" } });
    const wrong = await create(h, cookie, { password: "not the password" });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: { code: "invalid_credentials" } });
    expect(rows(h)).toHaveLength(0);
    expect(h.db.select().from(activity).all()).toHaveLength(0);

    const ok = await create(h, cookie, { password: PASSWORD });
    expect(ok.status).toBe(201);
    expect(rows(h)).toHaveLength(1);
  });

  it("with two-step verification on, also needs a current code (or a recovery code)", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const factor = await enableTotp(h, cookie);
    h.clock.t += STEP_MS;

    const noCode = await create(h, cookie, { password: PASSWORD });
    expect(noCode.status).toBe(401);
    expect(noCode.body).toEqual({ error: { code: "invalid_code" } });
    const wrongCode = await create(h, cookie, { password: PASSWORD, code: "000000" });
    expect(wrongCode.status).toBe(401);
    expect(wrongCode.body).toEqual({ error: { code: "invalid_code" } });
    // A right code with the wrong password is still a password failure.
    const wrongPassword = await create(h, cookie, {
      password: "nope",
      code: totpAt(factor.secret, h.clock.t),
    });
    expect(wrongPassword.body).toEqual({ error: { code: "invalid_credentials" } });
    expect(rows(h)).toHaveLength(0);

    const code = totpAt(factor.secret, h.clock.t);
    expect((await create(h, cookie, { password: PASSWORD, code })).status).toBe(201);
    // The step is spent: the same code cannot authorise a second credential.
    const replay = await create(h, cookie, { password: PASSWORD, code });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ error: { code: "invalid_code" } });

    const recovery = factor.recoveryCodes[0] ?? "";
    expect((await create(h, cookie, { password: PASSWORD, code: recovery })).status).toBe(201);
    expect(rows(h)).toHaveLength(2);
  });

  it("limits wrong passwords to 5 per 15 minutes, then answers 429 even for the right one", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    for (let i = 0; i < 5; i++) {
      expect((await create(h, cookie, { password: "nope" })).status).toBe(401);
    }
    const blocked = await create(h, cookie, { password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: "too_many_attempts" } });
    expect(rows(h)).toHaveLength(0);

    h.clock.t += 16 * 60 * 1000;
    expect((await create(h, cookie, { password: PASSWORD })).status).toBe(201);
  });

  it("counts parallel guesses before the password check finishes: at most 5 get a 401", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const burst = await Promise.all(
      Array.from({ length: 20 }, () => create(h, cookie, { password: "nope" })),
    );
    const statuses = burst.map((res) => res.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });

  it("does not count right passwords against the limit", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    for (let i = 0; i < 12; i++) {
      expect((await create(h, cookie, { password: PASSWORD })).status).toBe(201);
    }
  });
});

describe("password change", () => {
  const NEW_PASSWORD = "a brand new passphrase";
  const change = (h: Harness, cookie: string, body: object) =>
    h.post("/api/auth/password", body, { cookie });
  const secondSession = async (h: Harness, email = "admin@example.com", password = PASSWORD) => {
    const res = await h.post("/api/auth/login", { email, password });
    return { status: res.status, cookie: res.status === 200 ? sidCookie(res) : "" };
  };

  it("answers 204, switches the password, ends the other sessions, keeps the caller's, logs it", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const other = await secondSession(h);
    expect(other.status).toBe(200);

    h.clock.t += 1000;
    const res = await change(h, admin.cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(204);
    expect((await h.get("/api/auth/me", { cookie: other.cookie })).status).toBe(401);
    expect((await h.get("/api/auth/me", { cookie: admin.cookie })).status).toBe(200);
    expect((await secondSession(h, "admin@example.com", PASSWORD)).status).toBe(401);
    expect((await secondSession(h, "admin@example.com", NEW_PASSWORD)).status).toBe(200);

    const types = (await feed(h, "/api/activity", { cookie: admin.cookie })).events.map(
      (e) => e.type,
    );
    expect(types).toContain("password_changed");
    const admins = await feed(h, "/api/admin/activity", { cookie: admin.cookie });
    expect(admins.events.some((e) => e.type === "password_changed")).toBe(true);
    // Neither password is ever written to the log.
    const logged = JSON.stringify(h.db.select().from(activity).all());
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(NEW_PASSWORD);
  });

  it("refuses a wrong current password and changes nothing", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const other = await secondSession(h);
    const res = await change(h, admin.cookie, {
      currentPassword: "not it",
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "invalid_credentials" } });
    expect((await h.get("/api/auth/me", { cookie: other.cookie })).status).toBe(200);
    expect((await secondSession(h, "admin@example.com", PASSWORD)).status).toBe(200);
    expect(
      h.db
        .select()
        .from(activity)
        .all()
        .map((r) => r.type),
    ).not.toContain("password_changed");
  });

  it("applies the new-password rules and needs a session", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const short = await change(h, admin.cookie, {
      currentPassword: PASSWORD,
      newPassword: "short",
    });
    expect(short.status).toBe(400);
    expect(short.body).toEqual({ error: { code: "invalid_request" } });
    expect((await change(h, admin.cookie, { newPassword: NEW_PASSWORD })).status).toBe(400);
    const anonymous = await h.post("/api/auth/password", {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(anonymous.status).toBe(401);
  });

  it("shares the step-up limiter: 5 wrong passwords, then 429 even for the right one", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    for (let i = 0; i < 5; i++) {
      const res = await change(h, admin.cookie, {
        currentPassword: "nope",
        newPassword: NEW_PASSWORD,
      });
      expect(res.status).toBe(401);
    }
    const blocked = await change(h, admin.cookie, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(blocked.status).toBe(429);
    expect((await secondSession(h, "admin@example.com", PASSWORD)).status).toBe(200);
  });

  it("cannot be reached with an app password", async () => {
    const h = harness();
    const admin = await setupAdmin(h);
    const created = createdAppPasswordResponse.parse(
      (
        await h.post(
          "/api/auth/app-passwords",
          { name: "cli", password: PASSWORD },
          { cookie: admin.cookie },
        )
      ).body,
    );
    const res = await h.post(
      "/api/auth/password",
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      { bearer: created.token },
    );
    expect(res.status).toBe(404);
  });
});

describe("TOTP secrets at rest", () => {
  it("stores a sealed secret, never the base32 seed, and codes still verify", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const { secret } = await enableTotp(h, cookie);
    const stored = h.db.select().from(totp).get()?.secret ?? "";
    expect(stored).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain(secret);
    expect(await loginPending(h)).toMatch(/^sid=/);
  });

  it("seals a legacy plaintext secret on startup, once, and the user keeps working", async () => {
    const h = harness();
    const { cookie } = await setupAdmin(h);
    const { secret } = await enableTotp(h, cookie);
    // The state of a database written before SECRET_KEY existed.
    h.db.update(totp).set({ secret }).run();

    expect(sealLegacyTotpSecrets(h.db, TEST_SECRET_KEY)).toBe(1);
    const sealed = h.db.select().from(totp).get()?.secret ?? "";
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain(secret);
    expect(sealLegacyTotpSecrets(h.db, TEST_SECRET_KEY)).toBe(0);
    expect(h.db.select().from(totp).get()?.secret).toBe(sealed);

    h.clock.t += STEP_MS;
    const pending = await loginPending(h);
    const full = await h.post(
      "/api/auth/login/totp",
      { code: totpAt(secret, h.clock.t) },
      { cookie: pending },
    );
    expect(full.status).toBe(200);
  });
});
