import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import {
  TRASH_RETENTION_DAYS,
  createFolderRequest,
  existsRequest,
  uniqueName,
  updateFileRequest,
  type ExistsResponse,
  type FileNode,
  type FileVersion,
  type FolderListing,
  type TrashListing,
  type UsageResponse,
  type VersionListing,
} from "@cloud/shared";
import { recordActivity } from "../activity/record.js";
import { authOf, type SessionService } from "../auth/sessions.js";
import { recordChanges } from "../changes/record.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { fileVersions, files } from "../db/schema/index.js";
import { HttpError } from "../http/errors.js";
import { findVersion, sendBlob } from "./content.js";
import { createFolder, relocateItem, trashItem } from "./mutations.js";
import { removeBlob } from "./storage.js";
import { purgeAllTrashed, purgeItem } from "./trash.js";
import {
  activeSiblingNames,
  activeSubtree,
  breadcrumbsOf,
  getNode,
  getOrCreateRoot,
  isActive,
  listChildren,
  requireActive,
  requireTrashed,
  trashedNodes,
  usedBytes,
  type FileRow,
  type Tx,
} from "./tree.js";

function listing(tx: Tx, ownerId: string, folder: FileRow): FolderListing {
  return {
    folder: getNode(tx, folder.id),
    breadcrumbs: breadcrumbsOf(tx, folder.id),
    children: listChildren(tx, ownerId, folder.id),
  };
}

export function createFilesRouter(opts: {
  db: Db;
  sessions: SessionService;
  config: Config;
  now: () => number;
}): Router {
  const { db, sessions, config, now } = opts;
  const router = Router();
  // Scoped to the files surface so unknown /api paths still fall through to a plain 404.
  router.use(["/files", "/folders", "/usage", "/trash"], sessions.requireUser);

  router.get("/files/root", (_req, res) => {
    const { user } = authOf(res);
    const body: FolderListing = db.transaction((tx) =>
      listing(tx, user.id, getOrCreateRoot(tx, user.id, now())),
    );
    res.json(body);
  });

  router.get("/folders/:id", (req, res) => {
    const { user } = authOf(res);
    const folder = requireActive(db, user.id, req.params.id, "folder");
    const body: FolderListing = listing(db, user.id, folder);
    res.json(body);
  });

  router.post("/folders", (req, res) => {
    const { user } = authOf(res);
    const { parentId, name } = createFolderRequest.parse(req.body);
    const node: FileNode = db.transaction((tx) =>
      getNode(tx, createFolder(tx, user.id, parentId, name, now())),
    );
    res.status(201).json(node);
  });

  router.patch("/files/:id", (req, res) => {
    const { user } = authOf(res);
    const patch = updateFileRequest.parse(req.body);
    const node: FileNode = db.transaction((tx) => {
      const item = requireActive(tx, user.id, req.params.id);
      relocateItem(tx, user.id, item, patch, now());
      return getNode(tx, item.id);
    });
    res.json(node);
  });

  router.delete("/files/:id", (req, res) => {
    const { user } = authOf(res);
    db.transaction((tx) => {
      trashItem(tx, user.id, requireActive(tx, user.id, req.params.id), {
        at: now(),
        ip: req.ip,
      });
    });
    res.status(204).end();
  });

  router.get("/files/:id/content", (req, res) => {
    const { user } = authOf(res);
    const file = requireActive(db, user.id, req.params.id, "file");
    if (!file.currentVersionId) throw new HttpError(404, "not_found");
    sendBlob(
      config.dataDir,
      req,
      res,
      file,
      findVersion(db, user.id, file.id, file.currentVersionId),
    );
  });

  router.get("/files/:id/versions", (req, res) => {
    const { user } = authOf(res);
    const file = requireActive(db, user.id, req.params.id, "file");
    const rows = db
      .select()
      .from(fileVersions)
      .where(and(eq(fileVersions.fileId, file.id), eq(fileVersions.ownerId, user.id)))
      .orderBy(desc(fileVersions.createdAt), sql`"file_versions".rowid desc`)
      .all();
    const versions: FileVersion[] = rows.map((v) => ({
      id: v.id,
      size: v.size,
      mime: v.mime,
      sha256: v.sha256,
      createdAt: v.createdAt.toISOString(),
      current: v.id === file.currentVersionId,
    }));
    const body: VersionListing = { versions };
    res.json(body);
  });

  router.get("/files/:id/versions/:versionId/content", (req, res) => {
    const { user } = authOf(res);
    const file = requireActive(db, user.id, req.params.id, "file");
    sendBlob(
      config.dataDir,
      req,
      res,
      file,
      findVersion(db, user.id, file.id, req.params.versionId),
    );
  });

  router.post("/files/:id/versions/:versionId/restore", (req, res) => {
    const { user } = authOf(res);
    const node: FileNode = db.transaction((tx) => {
      const file = requireActive(tx, user.id, req.params.id, "file");
      const version = findVersion(tx, user.id, file.id, req.params.versionId);
      tx.update(files)
        .set({ currentVersionId: version.id, updatedAt: new Date(now()) })
        .where(eq(files.id, file.id))
        .run();
      recordChanges(tx, user.id, [file.id], now());
      return getNode(tx, file.id);
    });
    res.json(node);
  });

  router.delete("/files/:id/versions/:versionId", async (req, res) => {
    const { user } = authOf(res);
    const version = db.transaction((tx) => {
      const file = requireActive(tx, user.id, req.params.id, "file");
      const row = findVersion(tx, user.id, file.id, req.params.versionId);
      if (row.id === file.currentVersionId) throw new HttpError(409, "version_is_current");
      tx.delete(fileVersions).where(eq(fileVersions.id, row.id)).run();
      recordChanges(tx, user.id, [file.id], now());
      return row;
    });
    await removeBlob(config.dataDir, version.ownerId, version.id);
    res.status(204).end();
  });

  router.post("/files/exists", (req, res) => {
    const { user } = authOf(res);
    const { sha256s } = existsRequest.parse(req.body);
    const wanted = sql.join(
      [...new Set(sha256s)].map((hash) => sql`${hash}`),
      sql`, `,
    );
    // Every version of an active file counts; a file is active when nothing in its chain is trashed.
    const rows = db.all<{ sha256: string }>(sql`
      with recursive candidates(id) as (
        select distinct v.file_id from file_versions v
          join files f on f.id = v.file_id
         where v.owner_id = ${user.id} and f.owner_id = ${user.id} and f.kind = 'file'
           and v.sha256 in (${wanted})
      ), chain(file_id, parent_id, deleted_at, depth) as (
        select f.id, f.parent_id, f.deleted_at, 0 from files f where f.id in (select id from candidates)
        union all
        select c.file_id, p.parent_id, p.deleted_at, c.depth + 1
          from files p join chain c on p.id = c.parent_id
         where c.depth < 4096
      )
      select distinct v.sha256 from file_versions v
       where v.owner_id = ${user.id} and v.sha256 in (${wanted})
         and v.file_id in (select file_id from chain group by file_id having count(deleted_at) = 0)`);
    const body: ExistsResponse = { existing: rows.map((r) => r.sha256) };
    res.json(body);
  });

  router.get("/usage", (_req, res) => {
    const { user } = authOf(res);
    const body: UsageResponse = {
      usedBytes: usedBytes(db, user.id),
      quotaBytes: user.quotaBytes,
    };
    res.json(body);
  });

  router.get("/trash", (_req, res) => {
    const { user } = authOf(res);
    const body: TrashListing = {
      items: trashedNodes(db, user.id),
      retentionDays: TRASH_RETENTION_DAYS,
    };
    res.json(body);
  });

  router.post("/trash/:id/restore", (req, res) => {
    const { user } = authOf(res);
    const node: FileNode = db.transaction((tx) => {
      const item = requireTrashed(tx, user.id, req.params.id);
      const parentId =
        item.parentId !== null && isActive(tx, item.parentId)
          ? item.parentId
          : getOrCreateRoot(tx, user.id, now()).id;
      const name = uniqueName(item.name, activeSiblingNames(tx, parentId));
      const at = now();
      tx.update(files)
        .set({ deletedAt: null, parentId, name, updatedAt: new Date(at) })
        .where(eq(files.id, item.id))
        .run();
      recordChanges(tx, user.id, activeSubtree(tx, item.id), at);
      recordActivity(tx, {
        userId: user.id,
        type: "restore",
        fileId: item.id,
        detail: { name, kind: item.kind },
        ip: req.ip,
        at,
      });
      return getNode(tx, item.id);
    });
    res.json(node);
  });

  router.delete("/trash/:id", async (req, res) => {
    const { user } = authOf(res);
    requireTrashed(db, user.id, req.params.id);
    await purgeItem(db, config.dataDir, user.id, req.params.id, { now, ip: req.ip });
    res.status(204).end();
  });

  router.delete("/trash", async (req, res) => {
    const { user } = authOf(res);
    await purgeAllTrashed(db, config.dataDir, user.id, { now, ip: req.ip });
    res.status(204).end();
  });

  return router;
}
