import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import {
  createAppPasswordRequest,
  type AppPassword,
  type AppPasswordList,
  type CreatedAppPasswordResponse,
} from "@cloud/shared";
import { recordActivity } from "../activity/record.js";
import type { Db } from "../db/client.js";
import { appPasswords } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { authOf, type SessionService } from "./sessions.js";
import type { StepUp } from "./step-up.js";
import { hashToken } from "./tokens.js";

export function newAppPasswordToken(): string {
  return `cloud_${randomBytes(32).toString("base64url")}`;
}

function toAppPassword(row: typeof appPasswords.$inferSelect): AppPassword {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

export function createAppPasswordRouter(opts: {
  db: Db;
  sessions: SessionService;
  stepUp: StepUp;
  now: () => number;
}): Router {
  const { db, sessions, stepUp, now } = opts;
  const router = Router();
  router.use(sessions.requireUser);

  router.get("/", (_req, res) => {
    const rows = db
      .select()
      .from(appPasswords)
      .where(eq(appPasswords.userId, authOf(res).user.id))
      .orderBy(asc(appPasswords.createdAt))
      .all();
    const body: AppPasswordList = { appPasswords: rows.map(toAppPassword) };
    res.json(body);
  });

  router.post("/", async (req, res) => {
    const { name, password, code } = createAppPasswordRequest.parse(req.body);
    const userId = authOf(res).user.id;
    await stepUp.verify(userId, req.ip, { password, code });
    const token = newAppPasswordToken();
    const row = db.transaction((tx) => {
      const created = tx
        .insert(appPasswords)
        .values({
          id: crypto.randomUUID(),
          userId,
          tokenHash: hashToken(token),
          name,
          createdAt: new Date(now()),
        })
        .returning()
        .get();
      recordActivity(tx, {
        userId,
        type: "app_password_created",
        detail: { name },
        ip: req.ip,
        at: now(),
      });
      return created;
    });
    const body: CreatedAppPasswordResponse = { appPassword: toAppPassword(row), token };
    res.status(201).json(body);
  });

  router.delete("/:id", (req, res) => {
    const userId = authOf(res).user.id;
    db.transaction((tx) => {
      const row = tx
        .delete(appPasswords)
        .where(and(eq(appPasswords.id, req.params.id), eq(appPasswords.userId, userId)))
        .returning({ name: appPasswords.name })
        .all()[0];
      if (!row) throw new HttpError(404, "not_found");
      recordActivity(tx, {
        userId,
        type: "app_password_revoked",
        detail: { name: row.name },
        ip: req.ip,
        at: now(),
      });
    });
    res.status(204).end();
  });

  return router;
}
