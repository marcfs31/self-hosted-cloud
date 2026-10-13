import type { ErrorCode } from "@cloud/shared";

/**
 * The state of the upload panel: one item per file, and a pure reducer over it.
 * The tus calls live in uploads.ts; this module only decides what the state becomes.
 */

export type UploadStatus = "queued" | "uploading" | "paused" | "done" | "error" | "cancelled";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  parentId: string;
  /** The file this upload adds a version to, or null for a new file. */
  replaceId: string | null;
  status: UploadStatus;
  /** Bytes the server has accepted. */
  sent: number;
  error: ErrorCode | null;
  /** The ID the server gave the finished file. */
  fileId: string | null;
}

export interface NewUpload {
  id: string;
  name: string;
  size: number;
  parentId: string;
  replaceId: string | null;
}

export interface QueueState {
  items: readonly UploadItem[];
  /** Counts finished uploads, so a listing can refresh when it changes. */
  completed: number;
}

export type QueueAction =
  | { type: "add"; uploads: readonly NewUpload[] }
  | { type: "started"; id: string }
  | { type: "progress"; id: string; sent: number }
  | { type: "pause"; id: string }
  | { type: "resume"; id: string }
  | { type: "succeeded"; id: string; fileId: string | null }
  | { type: "failed"; id: string; code: ErrorCode }
  | { type: "cancel"; id: string }
  | { type: "retry"; id: string }
  | { type: "dismiss"; id: string }
  | { type: "clearFinished" };

export const initialQueue: QueueState = { items: [], completed: 0 };

/** How many files upload at the same time; the rest wait their turn. */
export const MAX_CONCURRENT_UPLOADS = 3;

const ACTIVE: readonly UploadStatus[] = ["queued", "uploading", "paused"];

export function isActive(status: UploadStatus): boolean {
  return ACTIVE.includes(status);
}

function update(
  state: QueueState,
  id: string,
  change: (item: UploadItem) => UploadItem,
): QueueState {
  const index = state.items.findIndex((i) => i.id === id);
  const item = state.items[index];
  if (!item) {
    return state;
  }
  const next = change(item);
  if (next === item) {
    return state;
  }
  return { ...state, items: state.items.map((i, at) => (at === index ? next : i)) };
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "add": {
      const known = new Set(state.items.map((i) => i.id));
      const added = action.uploads
        .filter((u) => !known.has(u.id))
        .map<UploadItem>((u) => ({
          ...u,
          status: "queued",
          sent: 0,
          error: null,
          fileId: null,
        }));
      return added.length === 0 ? state : { ...state, items: [...state.items, ...added] };
    }
    case "started":
      return update(state, action.id, (i) =>
        i.status === "queued" ? { ...i, status: "uploading" } : i,
      );
    case "progress":
      return update(state, action.id, (i) =>
        i.status === "uploading" ? { ...i, sent: Math.min(Math.max(action.sent, 0), i.size) } : i,
      );
    case "pause":
      return update(state, action.id, (i) =>
        i.status === "uploading" ? { ...i, status: "paused" } : i,
      );
    case "resume":
      return update(state, action.id, (i) =>
        i.status === "paused" ? { ...i, status: "uploading" } : i,
      );
    case "succeeded": {
      const item = state.items.find((i) => i.id === action.id);
      if (item?.status !== "uploading" && item?.status !== "paused") {
        return state;
      }
      const next = update(state, action.id, (i) => ({
        ...i,
        status: "done",
        sent: i.size,
        error: null,
        fileId: action.fileId,
      }));
      return { ...next, completed: next.completed + 1 };
    }
    case "failed":
      return update(state, action.id, (i) =>
        i.status === "uploading" || i.status === "paused"
          ? { ...i, status: "error", error: action.code }
          : i,
      );
    case "cancel":
      return update(state, action.id, (i) =>
        isActive(i.status) ? { ...i, status: "cancelled", error: null } : i,
      );
    case "retry":
      return update(state, action.id, (i) =>
        i.status === "error" || i.status === "cancelled"
          ? { ...i, status: "queued", sent: 0, error: null }
          : i,
      );
    case "dismiss":
      return state.items.some((i) => i.id === action.id && !isActive(i.status))
        ? { ...state, items: state.items.filter((i) => i.id !== action.id) }
        : state;
    case "clearFinished":
      return state.items.some((i) => !isActive(i.status))
        ? { ...state, items: state.items.filter((i) => isActive(i.status)) }
        : state;
  }
}

/** IDs of the queued uploads to start now, in order, without exceeding `max` running. */
export function nextToStart(state: QueueState, max: number = MAX_CONCURRENT_UPLOADS): string[] {
  const running = state.items.filter((i) => i.status === "uploading").length;
  return state.items
    .filter((i) => i.status === "queued")
    .slice(0, Math.max(0, max - running))
    .map((i) => i.id);
}

export interface QueueSummary {
  total: number;
  done: number;
  failed: number;
  cancelled: number;
  /** Waiting, uploading or paused. */
  active: number;
  /** Whole percent of the bytes of the files that were not cancelled. */
  percent: number;
}

export function summarize(items: readonly UploadItem[]): QueueSummary {
  let done = 0;
  let failed = 0;
  let cancelled = 0;
  let active = 0;
  let bytes = 0;
  let sent = 0;
  for (const item of items) {
    if (item.status === "done") {
      done += 1;
    } else if (item.status === "error") {
      failed += 1;
    } else if (item.status === "cancelled") {
      cancelled += 1;
      continue;
    } else {
      active += 1;
    }
    bytes += item.size;
    sent += item.status === "done" ? item.size : item.sent;
  }
  const percent = bytes === 0 ? (active === 0 ? 100 : 0) : Math.floor((sent / bytes) * 100);
  return { total: items.length, done, failed, cancelled, active, percent };
}

/** Whole percent of one file; an empty file is complete once it is done. */
export function itemPercent(item: UploadItem): number {
  if (item.status === "done") {
    return 100;
  }
  return item.size === 0 ? 0 : Math.floor((item.sent / item.size) * 100);
}
