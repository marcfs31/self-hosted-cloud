import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth.js";

export const passkeys = sqliteTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** WebAuthn credential ID, base64url. */
    credentialId: text("credential_id").notNull().unique(),
    publicKey: blob("public_key", { mode: "buffer" }).notNull(),
    counter: integer("counter").notNull(),
    /** JSON array of AuthenticatorTransport strings. */
    transports: text("transports").notNull().default("[]"),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("passkeys_user_id_idx").on(t.userId)],
);

/** One row per user. `enabledAt` null means set up but not yet confirmed with a code. */
export const totp = sqliteTable("totp", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Base32 shared secret. */
  secret: text("secret").notNull(),
  enabledAt: integer("enabled_at", { mode: "timestamp_ms" }),
  /** Last accepted 30 s time step; a code from this step or an earlier one is a replay. */
  lastUsedStep: integer("last_used_step"),
});

export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("recovery_codes_user_id_idx").on(t.userId)],
);

export const appPasswords = sqliteTable(
  "app_passwords",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("app_passwords_user_id_idx").on(t.userId)],
);

export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    /** No foreign key: files may be purged while their history stays. */
    fileId: text("file_id"),
    /** JSON object of string values. Never secrets. */
    detail: text("detail").notNull().default("{}"),
    ip: text("ip"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("activity_user_created_idx").on(t.userId, t.createdAt),
    index("activity_created_idx").on(t.createdAt),
  ],
);
