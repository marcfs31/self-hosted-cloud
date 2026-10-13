import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { parseCookie, stringifySetCookie } from "cookie";
import { and, asc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  passkeyLoginRequest,
  registerPasskeyRequest,
  type MeResponse,
  type Passkey,
  type PasskeyList,
} from "@cloud/shared";
import { recordActivity } from "../activity/record.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { passkeys, users } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { CHALLENGE_TTL_MS, createChallengeStore, type ChallengePurpose } from "./challenges.js";
import { createRateLimiter, FAILURE_LIMIT } from "./rate-limit.js";
import { authOf, toUser, type SessionService } from "./sessions.js";

const RP_NAME = "Cloud";
const CHALLENGE_COOKIE = "wa";
const COOKIE_PATH = "/api/auth/passkeys";

function toPasskey(row: typeof passkeys.$inferSelect): Passkey {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function parseTransports(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function createPasskeyRouter(opts: {
  db: Db;
  config: Config;
  sessions: SessionService;
  now: () => number;
}): Router {
  const { db, config, sessions: sessionService, now } = opts;
  const rpID = new URL(config.publicOrigin).hostname;
  const expectedOrigin = config.publicOrigin;
  const challenges = createChallengeStore(now);
  const loginLimiter = createRateLimiter({ ...FAILURE_LIMIT, now });
  const router = Router();

  function challengeCookie(value: string, maxAgeSeconds: number): string {
    return stringifySetCookie({
      name: CHALLENGE_COOKIE,
      value,
      httpOnly: true,
      sameSite: "strict",
      path: COOKIE_PATH,
      secure: config.production,
      maxAge: maxAgeSeconds,
    });
  }

  function issue(res: Response, purpose: ChallengePurpose, userId: string | null, c: string) {
    const id = challenges.put(purpose, userId, c);
    res.append("Set-Cookie", challengeCookie(id, CHALLENGE_TTL_MS / 1000));
  }

  /** Single use: the cookie is cleared and the stored challenge dropped on every attempt. */
  function consume(
    req: Request,
    res: Response,
    purpose: ChallengePurpose,
    userId: string | null,
  ): string | null {
    const id = parseCookie(req.headers.cookie ?? "")[CHALLENGE_COOKIE];
    res.append("Set-Cookie", challengeCookie("", 0));
    return challenges.take(id, purpose, userId);
  }

  router.post("/register/options", sessionService.requireUser, async (_req, res) => {
    const { id, email } = authOf(res).user;
    const existing = db.select().from(passkeys).where(eq(passkeys.userId, id)).all();
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: email,
      userID: new TextEncoder().encode(id),
      attestationType: "none",
      excludeCredentials: existing.map((row) => ({
        id: row.credentialId,
        transports: parseTransports(row.transports),
      })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    issue(res, "register", id, options.challenge);
    res.json(options);
  });

  router.post("/register/verify", sessionService.requireUser, async (req, res) => {
    const { name, response } = registerPasskeyRequest.parse(req.body);
    const { id: userId } = authOf(res).user;
    const expectedChallenge = consume(req, res, "register", userId);
    if (!expectedChallenge) throw new HttpError(400, "invalid_request");
    let verified;
    try {
      // The library validates the response's shape and throws on anything malformed; any
      // failure here is the client's, so it all maps to one 400.
      verified = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
        // User verification is only 'preferred' at registration; sign-in requires it.
        requireUserVerification: false,
      });
    } catch {
      throw new HttpError(400, "invalid_request");
    }
    if (!verified.verified) throw new HttpError(400, "invalid_request");
    const { credential } = verified.registrationInfo;
    const created = db.transaction((tx) => {
      const taken = tx
        .select({ id: passkeys.id })
        .from(passkeys)
        .where(eq(passkeys.credentialId, credential.id))
        .get();
      if (taken) throw new HttpError(409, "invalid_request");
      const row = tx
        .insert(passkeys)
        .values({
          id: crypto.randomUUID(),
          userId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: credential.counter,
          transports: JSON.stringify(credential.transports ?? []),
          name,
          createdAt: new Date(now()),
        })
        .returning()
        .get();
      recordActivity(tx, {
        userId,
        type: "passkey_added",
        detail: { name },
        ip: req.ip,
        at: now(),
      });
      return row;
    });
    res.status(201).json(toPasskey(created));
  });

  router.get("/", sessionService.requireUser, (_req, res) => {
    const rows = db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, authOf(res).user.id))
      .orderBy(asc(passkeys.createdAt))
      .all();
    const body: PasskeyList = { passkeys: rows.map(toPasskey) };
    res.json(body);
  });

  router.delete("/:id", sessionService.requireUser, (req: Request<{ id: string }>, res) => {
    const userId = authOf(res).user.id;
    db.transaction((tx) => {
      const row = tx
        .delete(passkeys)
        .where(and(eq(passkeys.id, req.params.id), eq(passkeys.userId, userId)))
        .returning({ name: passkeys.name })
        .all()[0];
      if (!row) throw new HttpError(404, "not_found");
      recordActivity(tx, {
        userId,
        type: "passkey_removed",
        detail: { name: row.name },
        ip: req.ip,
        at: now(),
      });
    });
    res.status(204).end();
  });

  router.post("/login/options", async (_req, res) => {
    const options = await generateAuthenticationOptions({
      rpID,
      // No allowCredentials: the browser offers the discoverable passkeys for this site.
      userVerification: "required",
    });
    issue(res, "login", null, options.challenge);
    res.json(options);
  });

  router.post("/login/verify", async (req, res) => {
    const { response } = passkeyLoginRequest.parse(req.body);
    const ip = req.ip ?? "unknown";
    // Counted before the awaits: parallel guesses must not all pass a not-yet-failed check.
    loginLimiter.begin(ip);
    const expectedChallenge = consume(req, res, "login", null);
    const fail = (knownUserId?: string): never => {
      if (knownUserId) {
        recordActivity(db, {
          userId: knownUserId,
          type: "login_failed",
          detail: { method: "passkey" },
          ip: req.ip,
          at: now(),
        });
      }
      throw new HttpError(401, "invalid_credentials");
    };
    if (!expectedChallenge) return fail();
    const credentialId = response.id;
    const stored =
      typeof credentialId === "string"
        ? db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).get()
        : undefined;
    if (!stored) return fail();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: response as unknown as AuthenticationResponseJSON,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
        // A passkey replaces password and second factor, so the authenticator must have
        // verified the user (PIN, biometrics).
        requireUserVerification: true,
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: stored.counter,
          transports: parseTransports(stored.transports),
        },
      });
    } catch {
      return fail(stored.userId);
    }
    if (!verification.verified) return fail(stored.userId);
    const owner = db.select().from(users).where(eq(users.id, stored.userId)).get();
    if (!owner) return fail();
    const token = db.transaction((tx) => {
      // The library has already rejected a counter that did not advance (cloned authenticator).
      tx.update(passkeys)
        .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date(now()) })
        .where(eq(passkeys.id, stored.id))
        .run();
      const created = sessionService.insert(tx, owner.id, req.get("user-agent"));
      recordActivity(tx, {
        userId: owner.id,
        type: "login_succeeded",
        detail: { method: "passkey", passkey: stored.name },
        ip: req.ip,
        at: now(),
      });
      return created;
    });
    loginLimiter.clear(ip);
    sessionService.setCookie(res, token);
    const body: MeResponse = { user: toUser(owner) };
    res.json(body);
  });

  return router;
}
