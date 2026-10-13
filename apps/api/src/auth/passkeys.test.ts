import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  meResponse,
  passkeyList,
  passkey as passkeySchema,
  totpSetupResponse,
} from "@cloud/shared";
import { createApp } from "../app.js";
import type { Config } from "../config.js";
import { TEST_SECRET_KEY } from "../testing/secret-key.js";
import { openDatabase } from "../db/client.js";
import { activity, passkeys, sessions } from "../db/schema/index.js";
import { totpAt } from "./totp.js";

const ORIGIN = "https://cloud.example.com";
const PASSWORD = "correct horse battery";

function harness() {
  const db = openDatabase(":memory:");
  const clock = { t: Date.UTC(2026, 9, 13, 12, 0, 0) };
  const config: Config = {
    production: true,
    port: 0,
    dataDir: mkdtempSync(join(tmpdir(), "cloud-passkeys-")),
    publicOrigin: ORIGIN,
    secretKey: TEST_SECRET_KEY,
  };
  const app = createApp({ config, version: "0.0.0", db, now: () => clock.t });
  const post = (path: string, body: object = {}, cookie?: string) => {
    const req = request(app).post(path).set("Origin", ORIGIN);
    if (cookie) void req.set("Cookie", cookie);
    return req.send(body);
  };
  const get = (path: string, cookie?: string) => {
    const req = request(app).get(path);
    return cookie ? req.set("Cookie", cookie) : req;
  };
  return { app, db, clock, post, get };
}
type Harness = ReturnType<typeof harness>;

function cookieValue(res: request.Response, name: string): string {
  const header = (res.get("Set-Cookie") ?? []).find((c) => c.startsWith(`${name}=`));
  if (!header) throw new Error(`no ${name} cookie`);
  return header.split(";")[0] ?? "";
}

async function setupAdmin(h: Harness) {
  const res = await h.post("/api/auth/setup", { email: "admin@example.com", password: PASSWORD });
  expect(res.status).toBe(201);
  return cookieValue(res, "sid");
}

// --- a minimal CBOR encoder and a software ES256 authenticator -------------------------------

type Cbor = number | string | Buffer | Map<number | string, Cbor>;

function head(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  return Buffer.from([(major << 5) | 25, value >> 8, value & 255]);
}

function cbor(value: Cbor): Buffer {
  if (typeof value === "number") {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value);
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  const parts: Buffer[] = [head(5, value.size)];
  for (const [key, item] of value) parts.push(cbor(key), cbor(item));
  return Buffer.concat(parts);
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest();
const b64u = (data: Buffer) => data.toString("base64url");

class SoftwareAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly x: Buffer;
  private readonly y: Buffer;
  counter = 0;

  constructor(private readonly rpId: string) {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    this.x = Buffer.from(jwk.x ?? "", "base64url");
    this.y = Buffer.from(jwk.y ?? "", "base64url");
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private authData(flags: number, tail: Buffer): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), counter, tail]);
  }

  /** A "none"-attestation registration response for the given options. */
  register(challenge: string, origin = ORIGIN) {
    const coseKey = cbor(
      new Map<number, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, this.x],
        [-3, this.y],
      ]),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLength, this.credentialId, coseKey]);
    const authData = this.authData(0x45, attested); // user present, verified, attested data
    const attestationObject = cbor(
      new Map<string, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(this.clientData("webauthn.create", challenge, origin)),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
    };
  }

  assert(challenge: string, opts: { origin?: string; uv?: boolean } = {}) {
    this.counter += 1;
    const authData = this.authData(opts.uv === false ? 0x01 : 0x05, Buffer.alloc(0));
    const clientDataJSON = this.clientData("webauthn.get", challenge, opts.origin ?? ORIGIN);
    const signature = createSign("SHA256")
      .update(Buffer.concat([authData, sha256(clientDataJSON)]))
      .sign(this.privateKey);
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: null,
      },
    };
  }
}

// ---------------------------------------------------------------------------------------------

interface Options {
  challenge: string;
  rp?: { id?: string; name?: string };
  rpId?: string;
  excludeCredentials?: { id: string }[];
  authenticatorSelection?: { residentKey?: string; userVerification?: string };
  allowCredentials?: unknown[];
  userVerification?: string;
  user?: { name: string };
}

async function registrationOptions(h: Harness, sid: string) {
  const res = await h.post("/api/auth/passkeys/register/options", {}, sid);
  expect(res.status).toBe(200);
  return { options: res.body as Options, wa: cookieValue(res, "wa"), res };
}

async function addPasskey(h: Harness, sid: string, name: string, device: SoftwareAuthenticator) {
  const { options, wa } = await registrationOptions(h, sid);
  const res = await h.post(
    "/api/auth/passkeys/register/verify",
    { name, password: PASSWORD, response: device.register(options.challenge) },
    `${sid}; ${wa}`,
  );
  return res;
}

describe("passkey registration: step-up re-authentication", () => {
  async function verifyWith(h: Harness, sid: string, extra: object, device: SoftwareAuthenticator) {
    const { options, wa } = await registrationOptions(h, sid);
    return h.post(
      "/api/auth/passkeys/register/verify",
      { name: "Laptop", response: device.register(options.challenge), ...extra },
      `${sid}; ${wa}`,
    );
  }

  it("refuses a request without the password, with a wrong one, and stores nothing", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const device = new SoftwareAuthenticator("cloud.example.com");
    const missing = await verifyWith(h, sid, {}, device);
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ error: { code: "invalid_request" } });
    const wrong = await verifyWith(h, sid, { password: "not the password" }, device);
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: { code: "invalid_credentials" } });
    expect(h.db.select().from(passkeys).all()).toHaveLength(0);
    expect((await verifyWith(h, sid, { password: PASSWORD }, device)).status).toBe(201);
  });

  it("does not spend the challenge on a wrong password: the same ceremony can be retried", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const device = new SoftwareAuthenticator("cloud.example.com");
    const { options, wa } = await registrationOptions(h, sid);
    const body = (password: string) => ({
      name: "Laptop",
      password,
      response: device.register(options.challenge),
    });
    const cookie = `${sid}; ${wa}`;
    expect((await h.post("/api/auth/passkeys/register/verify", body("nope"), cookie)).status).toBe(
      401,
    );
    expect(
      (await h.post("/api/auth/passkeys/register/verify", body(PASSWORD), cookie)).status,
    ).toBe(201);
  });

  it("also needs a current authenticator code when two-step verification is on", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const setup = totpSetupResponse.parse((await h.post("/api/auth/totp/setup", {}, sid)).body);
    const enable = await h.post(
      "/api/auth/totp/enable",
      { code: totpAt(setup.secret, h.clock.t) },
      sid,
    );
    expect(enable.status).toBe(200);
    h.clock.t += 30_000;
    const device = new SoftwareAuthenticator("cloud.example.com");

    const noCode = await verifyWith(h, sid, { password: PASSWORD }, device);
    expect(noCode.status).toBe(401);
    expect(noCode.body).toEqual({ error: { code: "invalid_code" } });
    const wrongCode = await verifyWith(h, sid, { password: PASSWORD, code: "000000" }, device);
    expect(wrongCode.status).toBe(401);
    expect(wrongCode.body).toEqual({ error: { code: "invalid_code" } });
    expect(h.db.select().from(passkeys).all()).toHaveLength(0);

    const code = totpAt(setup.secret, h.clock.t);
    expect((await verifyWith(h, sid, { password: PASSWORD, code }, device)).status).toBe(201);
  });

  it("limits wrong passwords to 5 and then answers 429, even for the right one", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const device = new SoftwareAuthenticator("cloud.example.com");
    for (let i = 0; i < 5; i++) {
      expect((await verifyWith(h, sid, { password: "nope" }, device)).status).toBe(401);
    }
    const blocked = await verifyWith(h, sid, { password: PASSWORD }, device);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: "too_many_attempts" } });
  });
});

describe("passkey registration", () => {
  it("issues creation options for the RP, excluding existing credentials, with a hardened cookie", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const first = await registrationOptions(h, sid);
    expect(first.options.rp).toEqual({ id: "cloud.example.com", name: "Cloud" });
    expect(first.options.user).toMatchObject({ name: "admin@example.com" });
    expect(first.options.challenge).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(first.options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "preferred",
    });
    expect(first.options.excludeCredentials ?? []).toEqual([]);
    const header = (first.res.get("Set-Cookie") ?? []).join();
    expect(header).toMatch(/wa=/);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Max-Age=300/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/Path=\/api\/auth\/passkeys/);

    const second = await registrationOptions(h, sid);
    expect(second.options.challenge).not.toBe(first.options.challenge);

    const device = new SoftwareAuthenticator("cloud.example.com");
    expect((await addPasskey(h, sid, "Laptop", device)).status).toBe(201);
    const third = await registrationOptions(h, sid);
    expect(third.options.excludeCredentials?.map((c) => c.id)).toEqual([b64u(device.credentialId)]);
  });

  it("requires a session", async () => {
    const h = harness();
    expect((await h.post("/api/auth/passkeys/register/options")).status).toBe(401);
    expect((await h.get("/api/auth/passkeys")).status).toBe(401);
  });

  it("stores a verified credential, lists it, and removes it", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const device = new SoftwareAuthenticator("cloud.example.com");
    const res = await addPasskey(h, sid, "  My laptop ", device);
    expect(res.status).toBe(201);
    const created = passkeySchema.parse(res.body);
    expect(created).toMatchObject({ name: "My laptop", lastUsedAt: null });

    const row = h.db.select().from(passkeys).get();
    expect(row?.credentialId).toBe(b64u(device.credentialId));
    expect(row?.counter).toBe(0);
    expect(JSON.parse(row?.transports ?? "[]")).toEqual(["internal"]);
    expect(row?.publicKey.length).toBeGreaterThan(20);

    const list = passkeyList.parse((await h.get("/api/auth/passkeys", sid)).body);
    expect(list.passkeys).toEqual([created]);
    expect(JSON.stringify(list)).not.toContain("publicKey");

    const gone = await request(h.app)
      .delete(`/api/auth/passkeys/${created.id}`)
      .set("Origin", ORIGIN)
      .set("Cookie", sid);
    expect(gone.status).toBe(204);
    expect(h.db.select().from(passkeys).all()).toHaveLength(0);
    const again = await request(h.app)
      .delete(`/api/auth/passkeys/${created.id}`)
      .set("Origin", ORIGIN)
      .set("Cookie", sid);
    expect(again.status).toBe(404);

    const types = h.db
      .select()
      .from(activity)
      .all()
      .map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(["passkey_added", "passkey_removed"]));
  });

  it("rejects a wrong challenge, a foreign origin, a replayed challenge and garbage", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const device = new SoftwareAuthenticator("cloud.example.com");
    const { options, wa } = await registrationOptions(h, sid);
    const cookie = `${sid}; ${wa}`;
    const verify = (response: object, c = cookie) =>
      h.post("/api/auth/passkeys/register/verify", { name: "x", password: PASSWORD, response }, c);

    // Wrong origin inside the signed client data.
    const evil = await verify(device.register(options.challenge, "https://evil.example"));
    expect(evil.status).toBe(400);
    // The challenge is single use: the failed attempt above consumed it.
    const replay = await verify(device.register(options.challenge));
    expect(replay.status).toBe(400);

    const fresh = await registrationOptions(h, sid);
    const wrongChallenge = await verify(
      device.register("AAAAAAAAAAAAAAAAAAAAAA"),
      `${sid}; ${fresh.wa}`,
    );
    expect(wrongChallenge.status).toBe(400);

    const third = await registrationOptions(h, sid);
    const garbage = await verify({ id: 1, nonsense: true }, `${sid}; ${third.wa}`);
    expect(garbage.status).toBe(400);
    expect(garbage.body).toEqual({ error: { code: "invalid_request" } });

    expect((await verify(device.register(options.challenge), sid)).status).toBe(400); // no wa cookie
    expect(h.db.select().from(passkeys).all()).toHaveLength(0);
  });

  it("expires a challenge after 5 minutes", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const device = new SoftwareAuthenticator("cloud.example.com");
    const { options, wa } = await registrationOptions(h, sid);
    h.clock.t += 5 * 60 * 1000 + 1;
    const res = await h.post(
      "/api/auth/passkeys/register/verify",
      { name: "x", password: PASSWORD, response: device.register(options.challenge) },
      `${sid}; ${wa}`,
    );
    expect(res.status).toBe(400);
  });

  it("does not accept a challenge issued to another user or for sign-in", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const device = new SoftwareAuthenticator("cloud.example.com");
    const login = await h.post("/api/auth/passkeys/login/options");
    const loginOptions = login.body as Options;
    const res = await h.post(
      "/api/auth/passkeys/register/verify",
      { name: "x", password: PASSWORD, response: device.register(loginOptions.challenge) },
      `${sid}; ${cookieValue(login, "wa")}`,
    );
    expect(res.status).toBe(400);
  });

  it("refuses to register the same credential twice", async () => {
    const h = harness();
    const sid = await setupAdmin(h);
    const device = new SoftwareAuthenticator("cloud.example.com");
    expect((await addPasskey(h, sid, "one", device)).status).toBe(201);
    expect((await addPasskey(h, sid, "two", device)).status).toBe(409);
    expect(h.db.select().from(passkeys).all()).toHaveLength(1);
  });
});

describe("passkey sign-in", () => {
  async function registered() {
    const h = harness();
    const sid = await setupAdmin(h);
    const device = new SoftwareAuthenticator("cloud.example.com");
    expect((await addPasskey(h, sid, "Laptop", device)).status).toBe(201);
    await h.post("/api/auth/logout", {}, sid);
    return { h, device };
  }

  async function loginOptions(h: Harness) {
    const res = await h.post("/api/auth/passkeys/login/options");
    expect(res.status).toBe(200);
    return { options: res.body as Options, wa: cookieValue(res, "wa") };
  }

  it("offers discoverable options without allowCredentials", async () => {
    const { h } = await registered();
    const { options } = await loginOptions(h);
    expect(options.rpId).toBe("cloud.example.com");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("required");
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });

  it("signs in with a valid assertion: full session, counter and last use updated, event logged", async () => {
    const { h, device } = await registered();
    const { options, wa } = await loginOptions(h);
    h.clock.t += 5000;
    const res = await h.post(
      "/api/auth/passkeys/login/verify",
      { response: device.assert(options.challenge) },
      wa,
    );
    expect(res.status).toBe(200);
    expect(meResponse.parse(res.body).user.email).toBe("admin@example.com");
    const sid = cookieValue(res, "sid");
    expect((await h.get("/api/auth/me", sid)).status).toBe(200);
    expect(h.db.select().from(sessions).where(eq(sessions.mfaPending, true)).all()).toHaveLength(0);

    const row = h.db.select().from(passkeys).get();
    expect(row?.counter).toBe(1);
    expect(row?.lastUsedAt?.getTime()).toBe(h.clock.t);
    const events = h.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === "login_succeeded");
    expect(events.map((e) => JSON.parse(e.detail) as unknown)).toEqual([
      { method: "passkey", passkey: "Laptop" },
    ]);

    // The challenge was consumed: replaying the same assertion fails.
    const replay = await h.post(
      "/api/auth/passkeys/login/verify",
      { response: device.assert(options.challenge) },
      wa,
    );
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ error: { code: "invalid_credentials" } });
  });

  it("satisfies the second factor: no mfaRequired even with TOTP enabled", async () => {
    const { h, device } = await registered();
    const login = await h.post("/api/auth/login", {
      email: "admin@example.com",
      password: PASSWORD,
    });
    const sid = cookieValue(login, "sid");
    // Enrol TOTP through the API, then sign in with the passkey only.
    const { totpAt } = await import("./totp.js");
    const setup = (await h.post("/api/auth/totp/setup", {}, sid)).body as { secret: string };
    expect(
      (await h.post("/api/auth/totp/enable", { code: totpAt(setup.secret, h.clock.t) }, sid))
        .status,
    ).toBe(200);
    const { options, wa } = await loginOptions(h);
    const res = await h.post(
      "/api/auth/passkeys/login/verify",
      { response: device.assert(options.challenge) },
      wa,
    );
    expect(res.status).toBe(200);
    expect(meResponse.parse(res.body).user.email).toBe("admin@example.com");
  });

  it("rejects a bad signature, an unknown credential, a wrong origin, no UV and garbage with 401", async () => {
    const { h, device } = await registered();
    const attempt = async (make: (challenge: string) => object, useCookie = true) => {
      h.clock.t += 16 * 60 * 1000; // keep each case clear of the failure limiter
      const { options, wa } = await loginOptions(h);
      return h.post(
        "/api/auth/passkeys/login/verify",
        { response: make(options.challenge) },
        useCookie ? wa : undefined,
      );
    };
    const stranger = new SoftwareAuthenticator("cloud.example.com");
    const forged = (challenge: string) => ({
      ...device.assert(challenge),
      id: b64u(device.credentialId),
      response: {
        ...device.assert(challenge).response,
        signature: stranger.assert(challenge).response.signature,
      },
    });

    for (const [label, make] of [
      ["forged signature", forged],
      ["unknown credential", (c: string) => stranger.assert(c)],
      ["wrong origin", (c: string) => device.assert(c, { origin: "https://evil.example" })],
      ["no user verification", (c: string) => device.assert(c, { uv: false })],
      ["garbage", () => ({ id: "x" })],
      ["empty", () => ({})],
      ["non-string id", () => ({ id: 5 })],
    ] as const) {
      const res = await attempt(make);
      expect(res.status, label).toBe(401);
      expect(res.body, label).toEqual({ error: { code: "invalid_credentials" } });
    }
    const noCookie = await attempt((c) => device.assert(c), false);
    expect(noCookie.status).toBe(401);
    expect(h.db.select().from(passkeys).get()?.counter).toBe(0);
    expect(h.db.select().from(sessions).all()).toHaveLength(0);

    // A known credential that failed to verify is logged against its owner.
    const failures = h.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === "login_failed");
    expect(failures.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a cloned authenticator whose counter did not advance", async () => {
    const { h, device } = await registered();
    const first = await loginOptions(h);
    expect(
      (
        await h.post(
          "/api/auth/passkeys/login/verify",
          { response: device.assert(first.options.challenge) },
          first.wa,
        )
      ).status,
    ).toBe(200);
    device.counter = 0; // a clone replays an old counter value
    const second = await loginOptions(h);
    const res = await h.post(
      "/api/auth/passkeys/login/verify",
      { response: device.assert(second.options.challenge) },
      second.wa,
    );
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failures per address", async () => {
    const { h } = await registered();
    for (let i = 0; i < 5; i++) {
      const { wa } = await loginOptions(h);
      expect(
        (await h.post("/api/auth/passkeys/login/verify", { response: { id: "x" } }, wa)).status,
      ).toBe(401);
    }
    const { wa } = await loginOptions(h);
    const blocked = await h.post("/api/auth/passkeys/login/verify", { response: { id: "x" } }, wa);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: "too_many_attempts" } });
  });
});
