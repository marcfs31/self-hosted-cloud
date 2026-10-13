import { z } from "zod";

/*
 * System dashboard contract (admin only; non-admins get 404 not_found):
 *
 *   GET /admin/system → SystemStatus
 *
 * Live values come from the API container (os module, /sys/class/thermal, statfs on DATA_DIR).
 * Host checks come from JSON files the host's systemd timers write into <DATA_DIR>/status/:
 *   backup.json        written by deploy/scripts/backup.sh
 *   restore-test.json  written by deploy/scripts/restore-test.sh
 *   health.json        written by deploy/scripts/health-check.sh (includes SMART)
 * each shaped like HostReport. A missing, unreadable or invalid file → state "unknown"; a file
 * older than its STALE_AFTER_HOURS → state "stale". Unknown and stale are never shown as healthy.
 */

export const STALE_AFTER_HOURS = { backup: 36, restoreTest: 24 * 40, health: 1 } as const;

/** The JSON each host script writes (atomically, via a temp file + mv). */
export const hostReport = z.object({
  ok: z.boolean(),
  checkedAt: z.iso.datetime(),
  /** Short machine-readable facts, e.g. { "smart": "PASSED", "freePercent": "41" }. */
  facts: z.record(z.string(), z.string()).default({}),
});
export type HostReport = z.infer<typeof hostReport>;

export const reportState = z.enum(["ok", "failing", "stale", "unknown"]);
export type ReportState = z.infer<typeof reportState>;

export const hostCheck = z.object({
  state: reportState,
  checkedAt: z.iso.datetime().nullable(),
  facts: z.record(z.string(), z.string()),
});
export type HostCheck = z.infer<typeof hostCheck>;

export const systemStatus = z.object({
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  cpu: z.object({
    cores: z.int().positive(),
    load1: z.number().nonnegative(),
    load5: z.number().nonnegative(),
    load15: z.number().nonnegative(),
    /** null when the thermal zone is not readable (unknown, not zero). */
    temperatureC: z.number().nullable(),
  }),
  memory: z.object({ totalBytes: z.int().nonnegative(), availableBytes: z.int().nonnegative() }),
  /** null when statfs on DATA_DIR fails. */
  storage: z
    .object({ totalBytes: z.int().nonnegative(), freeBytes: z.int().nonnegative() })
    .nullable(),
  backup: hostCheck,
  restoreTest: hostCheck,
  health: hostCheck,
});
export type SystemStatus = z.infer<typeof systemStatus>;
