import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth.js";
import { fileVersions, files } from "./files.js";

/*
 * Facts read from the bytes of an image or video version, filled in the background (see
 * photos/media-info.ts). A row without taken_at is a version whose date is unknown (the timeline
 * falls back to the upload time); a row with error set is a version the extractor gave up on, so
 * it is never retried. The row goes away with its version.
 */
export const mediaInfo = sqliteTable("media_info", {
  versionId: text("version_id")
    .primaryKey()
    .references(() => fileVersions.id, { onDelete: "cascade" }),
  takenAt: integer("taken_at", { mode: "timestamp_ms" }),
  width: integer("width"),
  height: integer("height"),
  extractedAt: integer("extracted_at", { mode: "timestamp_ms" }).notNull(),
  error: text("error"),
});

export const albums = sqliteTable(
  "albums",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("albums_owner_id_idx").on(t.ownerId)],
);

/** Membership survives trashing: an inactive file is only hidden until it is restored. */
export const albumItems = sqliteTable(
  "album_items",
  {
    albumId: text("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.albumId, t.fileId] }),
    index("album_items_file_id_idx").on(t.fileId),
  ],
);
