import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dictionaries } from "../i18n/index.js";
import type { SyncActivity } from "../sync/index.js";
import { Notifier, type Toast } from "./notifier.js";

const en = dictionaries.en;
let shown: Toast[];
let notifier: Notifier;

beforeEach(() => {
  vi.useFakeTimers();
  shown = [];
  notifier = new Notifier(
    (t) => shown.push(t),
    () => en,
    1000,
  );
});
afterEach(() => {
  notifier.dispose();
  vi.useRealTimers();
});

const activity = (patch: Partial<SyncActivity>): SyncActivity => ({
  type: "upload",
  path: "a.txt",
  phase: "done",
  ...patch,
});

describe("Notifier", () => {
  it("stays silent for ordinary transfers", () => {
    for (const type of ["upload", "download", "rename-remote", "trash-local"] as const) {
      notifier.onActivity(activity({ type, phase: "start" }));
      notifier.onActivity(activity({ type, phase: "done" }));
    }
    vi.advanceTimersByTime(60_000);
    expect(shown).toEqual([]);
  });

  it("announces one conflict by file name", () => {
    notifier.onActivity(
      activity({ type: "conflict", path: "docs/plan.md", to: "docs/plan (copy).md" }),
    );
    expect(shown).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual([
      {
        title: "Both versions were kept",
        body: "plan.md changed on two computers. A copy sits next to the original.",
      },
    ]);
  });

  it("batches several conflicts into one notification", () => {
    for (const path of ["a", "b", "c"]) notifier.onActivity(activity({ type: "conflict", path }));
    vi.advanceTimersByTime(1000);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe("3 files changed in two places");
  });

  it("batches failures into one notification with the reason", () => {
    notifier.onActivity(activity({ type: "upload", phase: "failed", code: "quota_exceeded" }));
    notifier.onActivity(activity({ type: "rejected", phase: "failed", code: "invalid_name" }));
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual([
      {
        title: "Syncing needs a look",
        body: `2 items could not be synced. ${en.reasons.quota_exceeded}`,
      },
    ]);
  });

  it("ignores failures that fix themselves", () => {
    notifier.onActivity(activity({ phase: "failed", code: "network" }));
    notifier.onActivity(activity({ phase: "failed", code: "changed_during_sync" }));
    vi.advanceTimersByTime(5000);
    expect(shown).toEqual([]);
  });

  it("announces a status error once until the status recovers", () => {
    const error = { state: "error", code: "unauthenticated", active: 0 } as const;
    notifier.onStatus(error);
    notifier.onStatus(error);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.body).toBe(en.reasons.unauthenticated);
    notifier.onStatus({ state: "idle", active: 0 });
    notifier.onStatus(error);
    expect(shown).toHaveLength(2);
  });

  it("does not announce offline, paused or unconfigured", () => {
    for (const state of ["offline", "paused", "unconfigured", "syncing", "idle"] as const) {
      notifier.onStatus({ state, active: 0 });
    }
    expect(shown).toEqual([]);
  });

  it("starts a new window after a flush", () => {
    notifier.onActivity(activity({ type: "conflict", path: "a" }));
    vi.advanceTimersByTime(1000);
    notifier.onActivity(activity({ type: "conflict", path: "b" }));
    vi.advanceTimersByTime(1000);
    expect(shown).toHaveLength(2);
  });
});
