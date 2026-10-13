import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/client.js";
import { activity, users } from "../db/schema/index.js";
import { ACTIVITY_RETENTION_MS, purgeOldActivity } from "./retention.js";
import { recordActivity } from "./record.js";

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

function setup() {
  const db = openDatabase(":memory:");
  db.insert(users)
    .values({
      id: "u1",
      email: "a@example.com",
      passwordHash: "x",
      role: "member",
      quotaBytes: 0,
      createdAt: new Date(NOW),
    })
    .run();
  const add = (at: number) => {
    recordActivity(db, { userId: "u1", type: "login_succeeded", at });
  };
  return { db, add };
}

describe("purgeOldActivity", () => {
  it("deletes events older than 365 days and keeps the rest", () => {
    const { db, add } = setup();
    add(NOW - ACTIVITY_RETENTION_MS - 1); // just too old
    add(NOW - ACTIVITY_RETENTION_MS - 400 * 24 * 3600 * 1000);
    add(NOW - ACTIVITY_RETENTION_MS); // exactly a year: kept
    add(NOW - 1000);
    add(NOW);

    expect(purgeOldActivity(db, () => NOW)).toBe(2);
    const left = db
      .select()
      .from(activity)
      .all()
      .map((r) => r.createdAt.getTime())
      .sort();
    expect(left).toEqual([NOW - ACTIVITY_RETENTION_MS, NOW - 1000, NOW]);
  });

  it("follows the injected clock and is idempotent", () => {
    const { db, add } = setup();
    add(NOW);
    expect(purgeOldActivity(db, () => NOW)).toBe(0);
    expect(purgeOldActivity(db, () => NOW + ACTIVITY_RETENTION_MS + 1)).toBe(1);
    expect(purgeOldActivity(db, () => NOW + ACTIVITY_RETENTION_MS + 1)).toBe(0);
    expect(db.select().from(activity).all()).toHaveLength(0);
  });
});
