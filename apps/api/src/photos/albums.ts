import { and, eq } from "drizzle-orm";
import { Router } from "express";
import {
  addAlbumItemsRequest,
  createAlbumRequest,
  renameAlbumRequest,
  type Album,
  type AlbumDetail,
  type AlbumList,
} from "@cloud/shared";
import { authOf, type SessionService } from "../auth/sessions.js";
import type { Db } from "../db/client.js";
import { albumItems, albums } from "../db/schema/index.js";
import type { Tx } from "../files/tree.js";
import { HttpError } from "../http/errors.js";
import { activePhotoIds, albumPhotos, albumsOf } from "./queries.js";

function requireAlbum(tx: Tx, ownerId: string, id: string): Album {
  const [found] = albumsOf(tx, ownerId, id);
  if (!found) throw new HttpError(404, "not_found");
  return found;
}

export function createAlbumsRouter(opts: {
  db: Db;
  sessions: SessionService;
  now: () => number;
}): Router {
  const { db, sessions, now } = opts;
  const router = Router();
  router.use("/albums", sessions.requireUser);

  router.get("/albums", (_req, res) => {
    const { user } = authOf(res);
    const body: AlbumList = { albums: albumsOf(db, user.id) };
    res.json(body);
  });

  router.post("/albums", (req, res) => {
    const { user } = authOf(res);
    const { name } = createAlbumRequest.parse(req.body);
    const album: Album = db.transaction((tx) => {
      const at = new Date(now());
      const id = crypto.randomUUID();
      tx.insert(albums).values({ id, ownerId: user.id, name, createdAt: at, updatedAt: at }).run();
      return requireAlbum(tx, user.id, id);
    });
    res.status(201).json(album);
  });

  router.get("/albums/:id", (req, res) => {
    const { user } = authOf(res);
    const body: AlbumDetail = db.transaction((tx) => ({
      album: requireAlbum(tx, user.id, req.params.id),
      items: albumPhotos(tx, user.id, req.params.id),
    }));
    res.json(body);
  });

  router.patch("/albums/:id", (req, res) => {
    const { user } = authOf(res);
    const { name } = renameAlbumRequest.parse(req.body);
    const album: Album = db.transaction((tx) => {
      requireAlbum(tx, user.id, req.params.id);
      tx.update(albums)
        .set({ name, updatedAt: new Date(now()) })
        .where(and(eq(albums.id, req.params.id), eq(albums.ownerId, user.id)))
        .run();
      return requireAlbum(tx, user.id, req.params.id);
    });
    res.json(album);
  });

  router.delete("/albums/:id", (req, res) => {
    const { user } = authOf(res);
    db.transaction((tx) => {
      requireAlbum(tx, user.id, req.params.id);
      tx.delete(albums)
        .where(and(eq(albums.id, req.params.id), eq(albums.ownerId, user.id)))
        .run();
    });
    res.status(204).end();
  });

  router.post("/albums/:id/items", (req, res) => {
    const { user } = authOf(res);
    const { fileIds } = addAlbumItemsRequest.parse(req.body);
    const wanted = [...new Set(fileIds)];
    db.transaction((tx) => {
      requireAlbum(tx, user.id, req.params.id);
      // All or nothing: one foreign, trashed or non-photo ID rejects the whole request.
      const valid = activePhotoIds(tx, user.id, wanted);
      if (wanted.some((id) => !valid.has(id))) throw new HttpError(404, "not_found");
      const at = new Date(now());
      const inserted = tx
        .insert(albumItems)
        .values(wanted.map((fileId) => ({ albumId: req.params.id, fileId, addedAt: at })))
        .onConflictDoNothing()
        .run();
      if (inserted.changes > 0) {
        tx.update(albums).set({ updatedAt: at }).where(eq(albums.id, req.params.id)).run();
      }
    });
    res.status(204).end();
  });

  router.delete("/albums/:id/items/:fileId", (req, res) => {
    const { user } = authOf(res);
    db.transaction((tx) => {
      requireAlbum(tx, user.id, req.params.id);
      const removed = tx
        .delete(albumItems)
        .where(and(eq(albumItems.albumId, req.params.id), eq(albumItems.fileId, req.params.fileId)))
        .run();
      if (removed.changes === 0) throw new HttpError(404, "not_found");
      tx.update(albums)
        .set({ updatedAt: new Date(now()) })
        .where(eq(albums.id, req.params.id))
        .run();
    });
    res.status(204).end();
  });

  return router;
}
