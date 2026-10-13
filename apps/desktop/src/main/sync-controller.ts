import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { EngineEvents, SyncActivity, SyncStatus } from "../sync/index.js";
import { ConfigDamagedError, type ConfigStore } from "./config-store.js";
import type { StoredConfig } from "./config.js";
import type { ShellStatus } from "./status.js";

/** The slice of SyncEngine the shell drives; a fake in the tests. */
export interface EngineHandle extends EventEmitter<EngineEvents> {
  readonly status: SyncStatus;
  start(): void;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
}

export interface EngineSettings {
  server: string;
  token: string;
  localRoot: string;
  stateFile: string;
  deviceName: string;
}

export interface ControllerDeps {
  store: ConfigStore;
  /** Directory for the engine's state files. */
  syncDir: string;
  createEngine(settings: EngineSettings): EngineHandle;
}

export interface ControllerEvents {
  status: [ShellStatus];
  activity: [SyncActivity];
}

/**
 * One state file per (server, account, folder). Pointing the app at another folder or account
 * therefore starts from a clean slate instead of reading the old state against the new folder,
 * which would look like "everything was deleted here".
 */
export function stateFileFor(
  syncDir: string,
  config: Pick<StoredConfig, "server" | "email" | "localFolder">,
): string {
  const key = createHash("sha256")
    .update(`${config.server}\n${config.email}\n${config.localFolder}`)
    .digest("hex")
    .slice(0, 16);
  return join(syncDir, `${key}.json`);
}

const TRANSFERS = new Set(["upload", "download"]);

/** Owns the SyncEngine's life: (re)creates it from the saved settings and turns its events into a ShellStatus. */
export class SyncController extends EventEmitter<ControllerEvents> {
  private engine: EngineHandle | undefined;
  private current: ShellStatus = { state: "unconfigured", active: 0 };
  private saved: StoredConfig | null = null;
  private wantsPause = false;
  private readonly inFlight = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ControllerDeps) {
    super();
  }

  get status(): ShellStatus {
    return this.current;
  }

  /** The settings the running engine was built from, null when not set up. */
  get config(): StoredConfig | null {
    return this.saved;
  }

  private set(next: ShellStatus): void {
    const prev = this.current;
    if (prev.state === next.state && prev.code === next.code && prev.active === next.active) return;
    this.current = next;
    this.emit("status", next);
  }

  /** (Re)loads the saved settings and restarts syncing with them. Calls run one at a time. */
  apply(): Promise<void> {
    const run = this.queue.then(() => this.applyNow());
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async applyNow(): Promise<void> {
    await this.teardown();
    this.saved = null;
    let config: StoredConfig | null;
    try {
      config = await this.deps.store.load();
    } catch (err) {
      this.set({
        state: "error",
        code: err instanceof ConfigDamagedError ? "config_damaged" : codeOf(err),
        active: 0,
      });
      return;
    }
    if (config === null) {
      this.set({ state: "unconfigured", active: 0 });
      return;
    }
    this.saved = config;
    const password = await this.deps.store.loadPassword();
    if (password.state === "missing") {
      this.set({ state: "unconfigured", active: 0 });
      return;
    }
    if (password.state === "unreadable") {
      this.set({ state: "error", code: "credentials_unreadable", active: 0 });
      return;
    }

    const engine = this.deps.createEngine({
      server: config.server,
      token: password.value,
      localRoot: config.localFolder,
      stateFile: stateFileFor(this.deps.syncDir, config),
      deviceName: config.deviceName,
    });
    this.engine = engine;
    engine.on("status", (status) => {
      if (this.engine !== engine) return;
      if (status.state !== "syncing") this.inFlight.clear();
      this.set({
        state: status.state,
        ...(status.code !== undefined && { code: status.code }),
        active: this.inFlight.size,
      });
    });
    engine.on("activity", (activity) => {
      if (this.engine !== engine) return;
      this.trackTransfer(activity);
      this.emit("activity", activity);
    });
    if (this.wantsPause) engine.pause();
    engine.start();
    if (!this.wantsPause) this.set({ state: "syncing", active: 0 });
  }

  private trackTransfer(activity: SyncActivity): void {
    if (!TRANSFERS.has(activity.type)) return;
    const key = `${activity.type}:${activity.path}`;
    if (activity.phase === "start") this.inFlight.add(key);
    else this.inFlight.delete(key);
    if (this.current.state === "syncing") this.set({ ...this.current, active: this.inFlight.size });
  }

  /** Pause when syncing, resume when paused. No-op without an engine. */
  togglePause(): void {
    const engine = this.engine;
    if (engine === undefined) return;
    if (this.wantsPause) {
      this.wantsPause = false;
      engine.resume();
    } else {
      this.wantsPause = true;
      engine.pause();
    }
  }

  private async teardown(): Promise<void> {
    const engine = this.engine;
    this.engine = undefined;
    this.inFlight.clear();
    if (engine === undefined) return;
    engine.removeAllListeners();
    await engine.stop();
  }

  /** Stops syncing and waits for the running pass to finish. */
  async stop(): Promise<void> {
    await this.queue;
    await this.teardown();
  }
}

function codeOf(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : "unknown";
}
