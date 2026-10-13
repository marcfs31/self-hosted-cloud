import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { files } from "./files.js";

/*
 * WebDAV dead properties: what a client stored with PROPPATCH, one row per file or folder and
 * property. `xml` is the whole property element as the client wrote it, with the namespace
 * bindings it needs declared on it. Rows follow the file row: a rename keeps them, a purge
 * (or the owner's deletion) removes them.
 */
export const davProperties = sqliteTable(
  "dav_properties",
  {
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    ns: text("ns").notNull(),
    name: text("name").notNull(),
    xml: text("xml").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.ns, t.name] })],
);
