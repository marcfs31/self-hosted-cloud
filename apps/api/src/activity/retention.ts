import { lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { activity } from "../db/schema/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVITY_RETENTION_MS = 365 * DAY_MS;

/** Deletes activity events older than a year; returns how many went. The server runs it hourly. */
export function purgeOldActivity(db: Db, now: () => number): number {
  const cutoff = new Date(now() - ACTIVITY_RETENTION_MS);
  return db.delete(activity).where(lt(activity.createdAt, cutoff)).run().changes;
}
