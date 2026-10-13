import { describe, expect, it } from "vitest";
import { STALE_AFTER_HOURS, systemStatus } from "@cloud/shared";
import { readHostCheck, readSystemStatus, type SystemProbes } from "./status.js";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const GIB = 1024 ** 3;

const STATUS_DIR = "/data/status";
const THERMAL = "/sys/class/thermal/thermal_zone0/temp";
const MEMINFO = "/proc/meminfo";

/** Fake machine: files is the whole filesystem; a missing key is ENOENT. */
function probes(
  files: Record<string, string> = {},
  over: Partial<SystemProbes> = {},
): SystemProbes {
  return {
    now: () => NOW,
    readText: (path) =>
      path in files
        ? Promise.resolve(files[path] ?? "")
        : Promise.reject(new Error(`ENOENT: ${path}`)),
    statfs: () => Promise.resolve({ bsize: 4096, blocks: 1000, bavail: 250 }),
    cores: () => 4,
    loadavg: () => [0.5, 0.25, 0.1],
    totalmem: () => 8 * GIB,
    freemem: () => 1 * GIB,
    uptime: () => 123.5,
    ...over,
  };
}

const report = (over: object = {}) =>
  JSON.stringify({ ok: true, checkedAt: iso(HOUR), facts: { smart: "PASSED" }, ...over });

describe("readHostCheck", () => {
  const path = `${STATUS_DIR}/health.json`;
  const check = (files: Record<string, string>, hours = STALE_AFTER_HOURS.health) =>
    readHostCheck(probes(files), path, hours);

  it("is ok for a fresh passing report and passes its facts through", async () => {
    const checkedAt = iso(10 * 60 * 1000);
    expect(await check({ [path]: report({ checkedAt }) })).toEqual({
      state: "ok",
      checkedAt,
      facts: { smart: "PASSED" },
    });
  });

  it("is ok exactly at the stale threshold and stale just past it", async () => {
    const atLimit = iso(STALE_AFTER_HOURS.health * HOUR);
    const pastLimit = iso(STALE_AFTER_HOURS.health * HOUR + 1);
    expect((await check({ [path]: report({ checkedAt: atLimit }) })).state).toBe("ok");
    const stale = await check({ [path]: report({ checkedAt: pastLimit }) });
    expect(stale).toMatchObject({ state: "stale", checkedAt: pastLimit });
  });

  it("is failing when ok is false, even if the report is also old", async () => {
    const fresh = await check({ [path]: report({ ok: false, facts: { smart: "FAILED" } }) });
    expect(fresh).toMatchObject({ state: "failing", facts: { smart: "FAILED" } });
    const old = await check({ [path]: report({ ok: false, checkedAt: iso(1000 * HOUR) }) });
    expect(old.state).toBe("failing");
  });

  it("defaults missing facts to an empty record", async () => {
    const res = await check({ [path]: JSON.stringify({ ok: true, checkedAt: iso(HOUR) }) });
    expect(res).toMatchObject({ state: "ok", facts: {} });
  });

  const unknown = { state: "unknown", checkedAt: null, facts: {} };

  it("is unknown when the file is missing", async () => {
    expect(await check({})).toEqual(unknown);
  });

  it.each([
    ["not JSON", "{not json"],
    ["empty file", ""],
    ["JSON null", "null"],
    ["ok is not a boolean", report({ ok: "yes" })],
    ["checkedAt without a Z offset", report({ checkedAt: "2026-10-13T11:00:00" })],
    ["checkedAt is not a date", report({ checkedAt: "yesterday" })],
    ["facts values are not strings", report({ facts: { freePercent: 41 } })],
    ["checkedAt missing", JSON.stringify({ ok: true, facts: {} })],
  ])("is unknown when the file is invalid: %s", async (_name, body) => {
    expect(await check({ [path]: body })).toEqual(unknown);
  });

  it("is unknown, not ok, when checkedAt is far in the future (clock fault)", async () => {
    const future = new Date(NOW + 2 * HOUR).toISOString();
    expect(await check({ [path]: report({ checkedAt: future }) })).toEqual(unknown);
    const withinSkew = new Date(NOW + 60 * 1000).toISOString();
    expect((await check({ [path]: report({ checkedAt: withinSkew }) })).state).toBe("ok");
  });
});

describe("readSystemStatus", () => {
  const opts = { dataDir: "/data", version: "1.2.3" };

  const allFresh = {
    [`${STATUS_DIR}/backup.json`]: report({ facts: { repositories: "2" } }),
    [`${STATUS_DIR}/restore-test.json`]: report({ facts: { integrity: "ok" } }),
    [`${STATUS_DIR}/health.json`]: report({ checkedAt: iso(5 * 60 * 1000) }),
  };

  it("assembles live values and host checks, and validates against the contract", async () => {
    const files = {
      ...allFresh,
      [THERMAL]: "52300\n",
      [MEMINFO]: "MemTotal: 8000 kB\nMemAvailable:    2048 kB\n",
    };
    const status = await readSystemStatus(probes(files), opts);
    expect(systemStatus.parse(status)).toEqual(status);
    expect(status).toMatchObject({
      version: "1.2.3",
      uptimeSeconds: 123.5,
      cpu: { cores: 4, load1: 0.5, load5: 0.25, load15: 0.1, temperatureC: 52.3 },
      memory: { totalBytes: 8 * GIB, availableBytes: 2048 * 1024 },
      storage: { totalBytes: 4096 * 1000, freeBytes: 4096 * 250 },
      backup: { state: "ok", facts: { repositories: "2" } },
      restoreTest: { state: "ok", facts: { integrity: "ok" } },
      health: { state: "ok" },
    });
  });

  it("reports one state per host check independently", async () => {
    const files = {
      [`${STATUS_DIR}/backup.json`]: report({
        checkedAt: iso(STALE_AFTER_HOURS.backup * HOUR + 1),
      }),
      [`${STATUS_DIR}/health.json`]: report({ ok: false }),
      // restore-test.json is missing
    };
    const status = await readSystemStatus(probes(files), opts);
    expect(status.backup.state).toBe("stale");
    expect(status.restoreTest).toEqual({ state: "unknown", checkedAt: null, facts: {} });
    expect(status.health.state).toBe("failing");
  });

  it("applies each report's own stale threshold", async () => {
    const age = (STALE_AFTER_HOURS.backup + 1) * HOUR; // stale for backup, fresh for restore-test
    const files = {
      [`${STATUS_DIR}/backup.json`]: report({ checkedAt: iso(age) }),
      [`${STATUS_DIR}/restore-test.json`]: report({ checkedAt: iso(age) }),
      [`${STATUS_DIR}/health.json`]: report({ checkedAt: iso(age) }),
    };
    const status = await readSystemStatus(probes(files), opts);
    expect([status.backup.state, status.restoreTest.state, status.health.state]).toEqual([
      "stale",
      "ok",
      "stale",
    ]);
  });

  describe("temperature", () => {
    const temp = async (files: Record<string, string>) =>
      (await readSystemStatus(probes(files), opts)).cpu.temperatureC;

    it("converts millidegrees to degrees Celsius with one decimal", async () => {
      expect(await temp({ [THERMAL]: "47000\n" })).toBe(47);
      expect(await temp({ [THERMAL]: "51649" })).toBe(51.6);
      expect(await temp({ [THERMAL]: "-5000" })).toBe(-5);
    });

    it("is null, not zero, when the zone is unreadable or garbage", async () => {
      expect(await temp({})).toBeNull();
      expect(await temp({ [THERMAL]: "" })).toBeNull();
      expect(await temp({ [THERMAL]: "hot" })).toBeNull();
    });
  });

  describe("memory", () => {
    it("prefers MemAvailable from /proc/meminfo", async () => {
      const files = {
        [MEMINFO]: "MemTotal:  8388608 kB\nMemFree: 1 kB\nMemAvailable: 4194304 kB\n",
      };
      const status = await readSystemStatus(probes(files), opts);
      expect(status.memory.availableBytes).toBe(4194304 * 1024);
    });

    it("falls back to freemem when /proc/meminfo is unreadable or has no MemAvailable", async () => {
      expect((await readSystemStatus(probes({}), opts)).memory.availableBytes).toBe(1 * GIB);
      const noField = { [MEMINFO]: "MemTotal: 8388608 kB\nMemFree: 1 kB\n" };
      expect((await readSystemStatus(probes(noField), opts)).memory.availableBytes).toBe(1 * GIB);
    });

    it("never reports more available than total and always an integer", async () => {
      const files = { [MEMINFO]: "MemAvailable: 999999999 kB\n" };
      expect((await readSystemStatus(probes(files), opts)).memory.availableBytes).toBe(8 * GIB);
      const odd = probes({}, { freemem: () => 1234.7 });
      expect(Number.isInteger((await readSystemStatus(odd, opts)).memory.availableBytes)).toBe(
        true,
      );
    });
  });

  it("reports storage null when statfs fails, and still answers the rest", async () => {
    const failing = probes(allFresh, { statfs: () => Promise.reject(new Error("EIO")) });
    const status = await readSystemStatus(failing, opts);
    expect(status.storage).toBeNull();
    expect(status.backup.state).toBe("ok");
  });

  it("passes the data directory to statfs and reads reports beneath it", async () => {
    const seen: string[] = [];
    const custom = probes(
      { "/mnt/x/status/backup.json": report() },
      { statfs: (p) => (seen.push(p), Promise.resolve({ bsize: 1, blocks: 2, bavail: 1 })) },
    );
    const status = await readSystemStatus(custom, { dataDir: "/mnt/x", version: "0.0.1" });
    expect(seen).toEqual(["/mnt/x"]);
    expect(status.backup.state).toBe("ok");
  });
});
