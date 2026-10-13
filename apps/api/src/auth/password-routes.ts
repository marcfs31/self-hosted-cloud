import { eq } from "drizzle-orm";
import { Router } from "express";
import { changePasswordRequest } from "@cloud/shared";
import { recordActivity } from "../activity/record.js";
import type { Db } from "../db/client.js";
import { users } from "../db/schema/index.js";
import { hashPassword } from "./passwords.js";
import { authOf, ownTokenHash, revokeOtherSessions, type SessionService } from "./sessions.js";
import type { StepUp } from "./step-up.js";

export function createPasswordRouter(opts: {
  db: Db;
  sessions: SessionService;
  stepUp: StepUp;
  now: () => number;
}): Router {
  const { db, sessions, stepUp, now } = opts;
  const router = Router();

  router.post("/password", sessions.requireUser, async (req, res) => {
    const { currentPassword, newPassword } = changePasswordRequest.parse(req.body);
    const { id: userId } = authOf(res).user;
    await stepUp.verifyPassword(userId, req.ip, currentPassword);
    const passwordHash = await hashPassword(newPassword);
    db.transaction((tx) => {
      tx.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
      // Whoever holds a stolen cookie must not outlive the password they did not know.
      revokeOtherSessions(tx, userId, ownTokenHash(res));
      recordActivity(tx, { userId, type: "password_changed", ip: req.ip, at: now() });
    });
    res.status(204).end();
  });

  return router;
}
