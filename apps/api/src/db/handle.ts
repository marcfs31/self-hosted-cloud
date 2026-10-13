import type { Db } from "./client.js";

/** What both the database and a transaction offer; lets a helper run inside the caller's transaction. */
export type DbHandle = Pick<Db, "select" | "insert" | "update" | "delete">;
