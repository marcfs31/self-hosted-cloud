import * as os from "node:os";
import { readFile, statfs } from "node:fs/promises";
import { join } from "node:path";
import {
  hostReport,
  STALE_AFTER_HOURS,
  systemStatus,
  type HostCheck,
  type SystemStatus,
} from "@cloud/shared";

const HOUR_MS = 60 * 60 * 1000;
/** A report stamped further in the future than this is a clock fault, not a fresh report. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const THERMAL_ZONE = "/sys/class/thermal/thermal_zone0/temp";
const MEMINFO = "/proc/meminfo";

/** Everything the status reads from the machine, injectable so tests are deterministic. */
export interface SystemProbes {
  /** Epoch ms. */
  now: () => number;
  /** Rejects when the file is missing or unreadable. */
  readText: (path: string) => Promise<string>;
  /** Rejects when statfs fails. */
  statfs: (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  cores: () => number;
  loadavg: () => number[];
  totalmem: () => number;
  freemem: () => number;
  uptime: () => number;
}

export function defaultProbes(now: () => number = Date.now): SystemProbes {
  return {
    now,
    readText: (path) => readFile(path, "utf8"),
    statfs: (path) => statfs(path),
    cores: () => os.cpus().length,
    loadavg: () => os.loadavg(),
    totalmem: () => os.totalmem(),
    freemem: () => os.freemem(),
    uptime: () => process.uptime(),
  };
}

async function readTemperatureC(p: SystemProbes): Promise<number | null> {
  try {
    const raw = (await p.readText(THERMAL_ZONE)).trim();
    const milli = raw === "" ? NaN : Number(raw); // Number("") is 0: unknown must not become 0 °C
    if (!Number.isFinite(milli)) return null;
    return Math.round(milli / 100) / 10;
  } catch {
    return null;
  }
}

async function readAvailableBytes(p: SystemProbes, totalBytes: number): Promise<number> {
  try {
    const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(await p.readText(MEMINFO));
    if (match?.[1]) return Math.min(Number(match[1]) * 1024, totalBytes);
  } catch {
    // Not Linux, or /proc is hidden: fall through to the portable value.
  }
  return Math.min(Math.round(p.freemem()), totalBytes);
}

async function readStorage(p: SystemProbes, dataDir: string): Promise<SystemStatus["storage"]> {
  try {
    const s = await p.statfs(dataDir);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

const unknownCheck = (): HostCheck => ({ state: "unknown", checkedAt: null, facts: {} });

/**
 * Failing beats stale (a stale failure is still a failure); a missing, unreadable, invalid or
 * future-dated report is unknown, never healthy.
 */
export async function readHostCheck(
  p: SystemProbes,
  path: string,
  staleAfterHours: number,
): Promise<HostCheck> {
  let report;
  try {
    report = hostReport.safeParse(JSON.parse(await p.readText(path)));
  } catch {
    return unknownCheck();
  }
  if (!report.success) return unknownCheck();
  const { ok, checkedAt, facts } = report.data;
  const ageMs = p.now() - Date.parse(checkedAt);
  if (ageMs < -MAX_CLOCK_SKEW_MS) return unknownCheck();
  if (!ok) return { state: "failing", checkedAt, facts };
  return { state: ageMs > staleAfterHours * HOUR_MS ? "stale" : "ok", checkedAt, facts };
}

export async function readSystemStatus(
  p: SystemProbes,
  opts: { dataDir: string; version: string },
): Promise<SystemStatus> {
  const statusDir = join(opts.dataDir, "status");
  const [load1 = 0, load5 = 0, load15 = 0] = p.loadavg();
  const totalBytes = p.totalmem();
  const [temperatureC, availableBytes, storage, backup, restoreTest, health] = await Promise.all([
    readTemperatureC(p),
    readAvailableBytes(p, totalBytes),
    readStorage(p, opts.dataDir),
    readHostCheck(p, join(statusDir, "backup.json"), STALE_AFTER_HOURS.backup),
    readHostCheck(p, join(statusDir, "restore-test.json"), STALE_AFTER_HOURS.restoreTest),
    readHostCheck(p, join(statusDir, "health.json"), STALE_AFTER_HOURS.health),
  ]);
  return systemStatus.parse({
    version: opts.version,
    uptimeSeconds: p.uptime(),
    cpu: { cores: Math.max(1, p.cores()), load1, load5, load15, temperatureC },
    memory: { totalBytes, availableBytes },
    storage,
    backup,
    restoreTest,
    health,
  });
}
