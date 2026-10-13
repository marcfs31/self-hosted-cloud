import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { photoPageQuery, thumbnailQuery, type PhotoPage } from "@cloud/shared";
import { authOf, type SessionService } from "../auth/sessions.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { fileVersions } from "../db/schema/index.js";
import { requireActive } from "../files/tree.js";
import { HttpError } from "../http/errors.js";
import { mediaKind } from "./kinds.js";
import { photoPage } from "./queries.js";
import { ThumbnailUnavailable, thumbnailFile } from "./thumbnails.js";
import { DEFAULT_MEDIA_TOOLS, type MediaTools } from "./tools.js";

export function createPhotosRouter(opts: {
  db: Db;
  sessions: SessionService;
  config: Config;
  tools?: Partial<MediaTools>;
}): Router {
  const { db, sessions, config } = opts;
  const tools: MediaTools = { ...DEFAULT_MEDIA_TOOLS, ...opts.tools };
  const router = Router();

  router.use("/files/:id/thumbnail", sessions.requireUser);
  router.get("/files/:id/thumbnail", async (req, res) => {
    const { user } = authOf(res);
    const { size } = thumbnailQuery.parse(req.query);
    const file = requireActive(db, user.id, req.params.id, "file");
    const version = file.currentVersionId
      ? db
          .select()
          .from(fileVersions)
          .where(and(eq(fileVersions.id, file.currentVersionId), eq(fileVersions.ownerId, user.id)))
          .get()
      : undefined;
    if (!version || mediaKind(version.mime) === null) throw new HttpError(404, "not_found");

    // The version ID changes whenever the bytes do, so the tag is exact; clients revalidate on
    // each use because the URL is per file, not per version.
    res.setHeader("ETag", `"${version.id}-${size}"`);
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.fresh) {
      res.status(304).end();
      return;
    }

    let path: string;
    try {
      path = await thumbnailFile({
        dataDir: config.dataDir,
        ownerId: user.id,
        versionId: version.id,
        mime: version.mime,
        size,
        tools,
      });
    } catch (err) {
      if (err instanceof ThumbnailUnavailable) throw new HttpError(404, "thumbnail_unavailable");
      throw err;
    }
    res.type("image/webp");
    res.sendFile(
      path,
      { dotfiles: "allow", cacheControl: false, etag: false, lastModified: false },
      (err) => {
        if (!err || res.headersSent) return;
        // Purged between generation and sending.
        res.status(404).json({ error: { code: "not_found" } });
      },
    );
  });

  router.use("/photos", sessions.requireUser);
  router.get("/photos", (req, res) => {
    const { user } = authOf(res);
    const query = photoPageQuery.parse(req.query);
    const body: PhotoPage = photoPage(db, user.id, {
      limit: query.limit,
      ...(query.cursor !== undefined && { cursor: query.cursor }),
    });
    res.json(body);
  });

  return router;
}
