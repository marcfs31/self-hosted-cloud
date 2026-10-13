import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth.js";

/*
 * A row is trashed only when deleted_at is set on it; its descendants keep deleted_at NULL and are
 * inactive because an ancestor is trashed (see files/tree.ts). Quota usage is never stored: it is
 * SUM(file_versions.size) for the owner.
 */
export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => files.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["file", "folder"] }).notNull(),
    // Not a foreign key: files and versions reference each other, and the version is inserted first.
    currentVersionId: text("current_version_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("files_one_root_per_owner")
      .on(t.ownerId)
      .where(sql`${t.parentId} is null`),
    uniqueIndex("files_active_name_per_parent")
      .on(t.parentId, t.name)
      .where(sql`${t.deletedAt} is null`),
    index("files_owner_id_idx").on(t.ownerId),
    index("files_parent_id_idx").on(t.parentId),
    index("files_deleted_at_idx").on(t.deletedAt),
  ],
);

export const fileVersions = sqliteTable(
  "file_versions",
  {
    id: text("id").primaryKey(),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    mime: text("mime").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("file_versions_file_id_idx").on(t.fileId),
    index("file_versions_owner_id_idx").on(t.ownerId),
  ],
);
