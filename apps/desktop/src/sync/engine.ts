import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ApiError, NetworkError, type SyncApi } from "../api/client.js";
import { trashIntoFolder } from "./fsops.js";
import { isIgnoredPath } from "./ignore.js";
import { emptyResult, SyncError, SyncPass, type SyncActivity, type SyncResult } from "./pass.js";
import { StateStore } from "./state.js";

export type { ActivityType, SyncActivity, SyncResult } from "./pass.js";
export { SyncError } from "./pass.js";

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export type SyncState = "idle" | "syncing" | "paused" | "error" | "offline";

export interface SyncStatus {
  state: SyncState;
  /** Why the engine is in "error": an API error code, "account_changed", "local_root_missing", … */
  code?: string;
}

export interface EngineEvents {
  status: [SyncStatus];
  activity: [SyncActivity];
}

export interface EngineOptions {
  api: SyncApi;
  /** The folder that mirrors the user's cloud. */
  localRoot: string;
  /** The JSON state file; its directory is the app's data dir (trash, temp). */
  stateFile: string;
  clock: Clock;
  deviceName: string;
  /** Moves a local item out of the sync folder without destroying it; Electron's shell.trashItem in the app. */
  trashItem?: (absPath: string) => Promise<void>;
  /** Parallel transfers (default 2). */
  concurrency?: number;
  /** Quiet time after a file-system event before syncing (default 750 ms). */
  debounceMs?: number;
  /** How often the change feed is polled (default 30 s). */
  pollMs?: number;
}

const MAX_PASSES = 4;

/**
 * Two-way folder sync against the cloud API. No Electron imports: everything it needs from the
 * shell is injected, so it can be driven headlessly.
 */
export class SyncEngine extends EventEmitter<EngineEvents> {
  private readonly store: StateStore;
  private readonly options: Required<Omit<EngineOptions, "trashItem">> & {
    trashItem: (abs: string) => Promise<void>;
  };
  private current: SyncStatus = { state: "idle" };
  private loaded = false;
  private paused = false;
  private started = false;
  private queue: Promise<unknown> = Promise.resolve();
  private watcher: FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private poll: NodeJS.Timeout | undefined;

  constructor(options: EngineOptions) {
    super();
    const dataDir = dirname(resolve(options.stateFile));
    this.store = new StateStore(options.stateFile);
    this.options = {
      concurrency: 2,
      debounceMs: 750,
      pollMs: 30_000,
      ...options,
      localRoot: resolve(options.localRoot),
      trashItem:
        options.trashItem ??
        trashIntoFolder(join(dataDir, ".cloud-trash"), () => options.clock.now()),
    };
  }

  private get isPaused(): boolean {
    return this.paused;
  }

  get status(): SyncStatus {
    return this.current;
  }

  private setStatus(next: SyncStatus): void {
    if (this.current.state === next.state && this.current.code === next.code) return;
    this.current = next;
    this.emit("status", next);
  }

  /** Begin watching the folder and polling the feed; the first sync starts immediately. */
  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      this.watcher = watch(this.options.localRoot, { recursive: true }, (_event, filename) => {
        const rel = (filename ?? "").split(sep).join("/");
        if (rel === "" || !isIgnoredPath(rel)) this.schedule();
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch {
      // Watching is an optimisation; the poll still finds local changes.
    }
    this.poll = setInterval(() => {
      this.requestSync();
    }, this.options.pollMs);
    this.poll.unref();
    this.requestSync();
  }

  /** Stop watching and wait for a running sync to finish. */
  async stop(): Promise<void> {
    this.started = false;
    clearTimeout(this.debounce);
    clearInterval(this.poll);
    this.debounce = undefined;
    this.poll = undefined;
    this.watcher?.close();
    this.watcher = undefined;
    await this.queue;
  }

  pause(): void {
    this.paused = true;
    this.setStatus({ state: "paused" });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.setStatus({ state: "idle" });
    if (this.started) this.requestSync();
  }

  private schedule(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.requestSync();
    }, this.options.debounceMs);
    this.debounce.unref();
  }

  private requestSync(): void {
    if (!this.started || this.paused) return;
    this.syncOnce().catch(() => undefined); // the status already says what went wrong
  }

  /**
   * One full reconcile (repeated while a pass leaves work for the next scan). Syncs run one at a
   * time. Per-file failures are reported in the result and as activity; a condition that stops
   * the whole sync (offline, rejected credentials, wrong account, missing folder) rejects.
   */
  syncOnce(): Promise<SyncResult> {
    const run = this.queue.then(() => this.runLocked());
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runLocked(): Promise<SyncResult> {
    const total = emptyResult();
    if (this.paused) return total;
    this.setStatus({ state: "syncing" });
    try {
      if (!this.loaded) {
        await this.store.load();
        this.loaded = true;
      }
      for (let i = 0; i < MAX_PASSES; i++) {
        const pass = new SyncPass({
          api: this.options.api,
          localRoot: this.options.localRoot,
          skipAbs: this.skipPaths(),
          store: this.store,
          now: () => this.options.clock.now(),
          deviceName: this.options.deviceName,
          trashItem: this.options.trashItem,
          concurrency: this.options.concurrency,
          activity: (activity) => this.emit("activity", activity),
        });
        await pass.run();
        for (const key of Object.keys(total) as (keyof SyncResult)[])
          total[key] += pass.result[key];
        if (!pass.rerun) break;
      }
      this.setStatus({ state: this.isPaused ? "paused" : "idle" });
      return total;
    } catch (err) {
      this.setStatus(statusOf(err));
      throw err;
    }
  }

  /** The app's data dir is skipped when the user put it inside the sync folder. */
  private skipPaths(): string[] {
    const dataDir = dirname(resolve(this.store.file));
    const rel = relative(this.options.localRoot, dataDir);
    return rel === "" || rel.startsWith("..") ? [] : [dataDir];
  }
}

function statusOf(err: unknown): SyncStatus {
  if (err instanceof NetworkError) return { state: "offline" };
  if (err instanceof ApiError) {
    return { state: "error", code: err.code ?? `http_${String(err.status)}` };
  }
  if (err instanceof SyncError) return { state: "error", code: err.code };
  const code = (err as NodeJS.ErrnoException).code;
  return { state: "error", code: typeof code === "string" ? code : "unknown" };
}
