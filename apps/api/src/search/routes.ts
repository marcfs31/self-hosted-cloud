import { Router } from "express";
import { searchQuery, type SearchResponse } from "@cloud/shared";
import { authOf, type SessionService } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { search } from "./search.js";

export function createSearchRouter(opts: { db: Db; sessions: SessionService }): Router {
  const { db, sessions } = opts;
  const router = Router();
  router.use(sessions.requireUser);

  router.get("/", (req, res) => {
    const { user } = authOf(res);
    const { q, limit } = searchQuery.parse(req.query);
    const body: SearchResponse = { results: db.transaction((tx) => search(tx, user.id, q, limit)) };
    res.json(body);
  });

  return router;
}
