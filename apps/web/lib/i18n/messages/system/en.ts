import type { Widen } from "../../types";

export const en = {
  title: "System",
  adminLink: "System status",
  adminLinkNote: "How the server, its storage and its backups are doing.",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  loading: "Loading system status…",
  lastUpdated: (time: string) => `Last updated at ${time}`,
  updatedNotice: "Status updated",
  autoRefresh: "Refreshes by itself every 30 seconds while this tab is visible.",
  outdatedBadge: "Outdated",
  refreshFailed: (time: string) =>
    `Couldn't refresh the status. You're seeing what the server reported at ${time}.`,
  unknown: "Unknown",
  server: {
    title: "This server",
    version: "Version",
    uptime: "Running for",
    cores: "Processor cores",
    load: "Load average (1 / 5 / 15 min)",
    temperature: "Temperature",
  },
  memory: {
    title: "Memory",
    label: "Memory in use",
    usedOf: (used: string, total: string) => `${used} of ${total}`,
    available: (value: string) => `${value} available`,
  },
  storage: {
    title: "Storage",
    label: "Storage used on /data",
    usedOf: (used: string, total: string) => `${used} of ${total}`,
    free: (value: string) => `${value} free`,
    unknown: "Unknown. The server couldn't read the disk.",
  },
  checks: {
    title: "Host checks",
    intro: "Scheduled jobs on the host report their results here.",
    backup: "Backup",
    restoreTest: "Restore test",
    health: "Health",
    state: {
      ok: "OK",
      failing: "Failing",
      stale: "Stale",
      unknown: "Unknown",
    },
    checked: (relative: string, exact: string) => `Checked ${relative} (${exact})`,
    neverReported: "Never reported",
    help: {
      failing: "The last run reported a problem. Check the log on the host to see why.",
      stale: (age: string) =>
        `The host hasn't reported in ${age}. Check that its systemd timer is still running.`,
      unknown:
        "The host has never sent a report, or it couldn't be read. Check that the systemd timer is installed and has run.",
    },
    noFacts: "No details were reported.",
    facts: {
      endpoint: "Health endpoint (HTTP status)",
      freePercent: "Free space (%)",
      smart: "SMART status",
      repositories: "Repositories",
      failedRepositories: "Failed repositories",
      snapshot: "Database snapshot",
      integrity: "Integrity",
      files: "Files restored / listed",
    },
  },
};

export type System = Widen<typeof en>;
