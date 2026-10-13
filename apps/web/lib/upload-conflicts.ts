/**
 * Name conflicts when uploading: a file whose name is already taken in the target folder.
 * The person is asked once per conflict, or once for all the rest ("apply to all remaining").
 * Pure state, so the rules are testable without a browser.
 */

export type ConflictChoice = "replace" | "keepBoth" | "skip";

export interface Conflict {
  /** Identifies the conflicting upload (its position in the selection). */
  key: string;
  /** False when the existing item is a folder: it cannot get a new version. */
  canReplace: boolean;
}

export interface ConflictState {
  conflicts: readonly Conflict[];
  decided: Readonly<Record<string, ConflictChoice>>;
}

export function startConflicts(conflicts: readonly Conflict[]): ConflictState {
  return { conflicts, decided: {} };
}

/** The first conflict still waiting for an answer, or null when all are settled. */
export function currentConflict(state: ConflictState): Conflict | null {
  return state.conflicts.find((c) => state.decided[c.key] === undefined) ?? null;
}

/** How many conflicts are still waiting, the current one included. */
export function undecidedCount(state: ConflictState): number {
  return state.conflicts.filter((c) => state.decided[c.key] === undefined).length;
}

/** "Replace" is impossible for a folder; keeping both never loses anything, so it stands in. */
function effectiveChoice(conflict: Conflict, choice: ConflictChoice): ConflictChoice {
  return choice === "replace" && !conflict.canReplace ? "keepBoth" : choice;
}

/** Answers the current conflict, and every remaining one too when `applyToAll` is set. */
export function resolveConflict(
  state: ConflictState,
  choice: ConflictChoice,
  applyToAll: boolean,
): ConflictState {
  const current = currentConflict(state);
  if (!current) {
    return state;
  }
  const decided: Record<string, ConflictChoice> = { ...state.decided };
  for (const conflict of state.conflicts) {
    if (decided[conflict.key] !== undefined) {
      continue;
    }
    if (conflict.key === current.key || applyToAll) {
      decided[conflict.key] = effectiveChoice(conflict, choice);
    }
  }
  return { conflicts: state.conflicts, decided };
}

export function isResolved(state: ConflictState): boolean {
  return currentConflict(state) === null;
}

export interface PlannedUpload<T> {
  item: T;
  /** The file to give a new version, or null to upload a new file (a taken name gets a suffix). */
  replaceId: string | null;
}

/**
 * Turns the answers into what to upload. `existingId` is the ID of the same-named active
 * sibling, if any. A skipped file is dropped; a file with no conflict uploads as is.
 */
export function planUploads<T extends { key: string }>(
  items: readonly T[],
  existingId: (item: T) => string | null,
  state: ConflictState,
): PlannedUpload<T>[] {
  const plan: PlannedUpload<T>[] = [];
  for (const item of items) {
    const choice = state.decided[item.key];
    if (choice === "skip") {
      continue;
    }
    const existing = existingId(item);
    plan.push({ item, replaceId: choice === "replace" ? existing : null });
  }
  return plan;
}
