import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth.js";
import { files } from "./files.js";

/*
 * A public link to one file or folder. Only the SHA-256 of the raw token is stored. The target's
 * state decides whether the link works: a share of a trashed item answers 404 and works again
 * once the item is restored; purging the item deletes the share with it.
 */
export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    kind: text("kind", { enum: ["file", "folder"] }).notNull(),
    allowUpload: integer("allow_upload", { mode: "boolean" }).notNull().default(false),
    passwordHash: text("password_hash"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("shares_owner_id_idx").on(t.ownerId), index("shares_file_id_idx").on(t.fileId)],
);
