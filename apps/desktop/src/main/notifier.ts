import { format, type Dictionary } from "../i18n/index.js";
import type { SyncActivity } from "../sync/index.js";
import { reasonFor, type ShellStatus } from "./status.js";

export interface Toast {
  title: string;
  body: string;
}

/** Failures that fix themselves on the next pass and are not worth interrupting anyone for. */
const QUIET_CODES = new Set(["network", "changed_during_sync"]);

const WINDOW_MS = 10_000;

/**
 * Notifies about conflicts and problems only, and never more than once per window: events are
 * batched, and a status error is announced once until the status recovers. Routine transfers,
 * pausing and going offline are silent.
 */
export class Notifier {
  private conflicts: string[] = [];
  private problems: string[] = [];
  private timer: NodeJS.Timeout | undefined;
  private announcedError: string | undefined;

  constructor(
    private readonly show: (toast: Toast) => void,
    private readonly dict: () => Dictionary,
    private readonly windowMs = WINDOW_MS,
  ) {}

  onActivity(activity: SyncActivity): void {
    if (activity.type === "conflict" && activity.phase === "done") {
      this.conflicts.push(activity.path.split("/").at(-1) ?? activity.path);
    } else if (activity.phase === "failed" && !QUIET_CODES.has(activity.code ?? "unknown")) {
      this.problems.push(activity.code ?? "unknown");
    } else {
      return;
    }
    this.timer ??= setTimeout(() => {
      this.flush();
    }, this.windowMs);
  }

  onStatus(status: ShellStatus): void {
    if (status.state !== "error") {
      this.announcedError = undefined;
      return;
    }
    const code = status.code ?? "unknown";
    if (this.announcedError === code) return;
    this.announcedError = code;
    const dict = this.dict();
    this.show({
      title: dict.notifications.problemTitle,
      body: format(dict.notifications.problemBody, { reason: reasonFor(dict, code) }),
    });
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const dict = this.dict();
    const conflicts = this.conflicts;
    const problems = this.problems;
    this.conflicts = [];
    this.problems = [];

    const [firstConflict] = conflicts;
    if (firstConflict !== undefined) {
      this.show(
        conflicts.length === 1
          ? {
              title: dict.notifications.conflictOneTitle,
              body: format(dict.notifications.conflictOneBody, { name: firstConflict }),
            }
          : {
              title: format(dict.notifications.conflictManyTitle, { count: conflicts.length }),
              body: dict.notifications.conflictManyBody,
            },
      );
    }
    const [firstProblem] = problems;
    if (firstProblem !== undefined) {
      const reason = reasonFor(dict, firstProblem);
      this.show({
        title: dict.notifications.problemTitle,
        body:
          problems.length === 1
            ? format(dict.notifications.problemBody, { reason })
            : format(dict.notifications.problemItemsBody, { count: problems.length, reason }),
      });
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
