import { describe, expect, it } from "vitest";
import {
  initialQueue,
  itemPercent,
  nextToStart,
  queueReducer,
  summarize,
  type NewUpload,
  type QueueAction,
  type QueueState,
} from "./upload-queue";

function upload(id: string, size = 100): NewUpload {
  return { id, name: `${id}.txt`, size, parentId: "folder", replaceId: null };
}

function run(actions: QueueAction[], from: QueueState = initialQueue): QueueState {
  return actions.reduce(queueReducer, from);
}

function statusOf(state: QueueState, id: string): string | undefined {
  return state.items.find((i) => i.id === id)?.status;
}

describe("upload queue", () => {
  it("adds files as queued and ignores a repeated ID", () => {
    const state = run([
      { type: "add", uploads: [upload("a"), upload("b")] },
      { type: "add", uploads: [upload("a")] },
    ]);
    expect(state.items.map((i) => [i.id, i.status, i.sent])).toEqual([
      ["a", "queued", 0],
      ["b", "queued", 0],
    ]);
  });

  it("starts at most three at a time, and starts the next when one finishes", () => {
    let state = run([{ type: "add", uploads: ["a", "b", "c", "d", "e"].map((id) => upload(id)) }]);
    expect(nextToStart(state)).toEqual(["a", "b", "c"]);
    state = run(
      [
        { type: "started", id: "a" },
        { type: "started", id: "b" },
        { type: "started", id: "c" },
      ],
      state,
    );
    expect(nextToStart(state)).toEqual([]);
    state = run([{ type: "succeeded", id: "a", fileId: "file-a" }], state);
    expect(nextToStart(state)).toEqual(["d"]);
  });

  it("does not count paused uploads against the limit", () => {
    const state = run([
      { type: "add", uploads: ["a", "b"].map((id) => upload(id)) },
      { type: "started", id: "a" },
      { type: "pause", id: "a" },
    ]);
    expect(statusOf(state, "a")).toBe("paused");
    expect(nextToStart(state, 1)).toEqual(["b"]);
  });

  it("clamps progress, and ignores progress for an upload that is not running", () => {
    let state = run([
      { type: "add", uploads: [upload("a", 50)] },
      { type: "progress", id: "a", sent: 10 },
    ]);
    expect(state.items[0]?.sent).toBe(0);
    state = run(
      [
        { type: "started", id: "a" },
        { type: "progress", id: "a", sent: 9000 },
      ],
      state,
    );
    expect(state.items[0]?.sent).toBe(50);
  });

  it("pauses and resumes only a running upload", () => {
    let state = run([
      { type: "add", uploads: [upload("a")] },
      { type: "pause", id: "a" },
    ]);
    expect(statusOf(state, "a")).toBe("queued");
    state = run(
      [
        { type: "started", id: "a" },
        { type: "pause", id: "a" },
      ],
      state,
    );
    expect(statusOf(state, "a")).toBe("paused");
    state = run([{ type: "resume", id: "a" }], state);
    expect(statusOf(state, "a")).toBe("uploading");
  });

  it("counts a finished upload once and keeps the new file ID", () => {
    const state = run([
      { type: "add", uploads: [upload("a")] },
      { type: "started", id: "a" },
      { type: "succeeded", id: "a", fileId: "file-a" },
      { type: "succeeded", id: "a", fileId: "other" },
    ]);
    expect(state.completed).toBe(1);
    expect(state.items[0]).toMatchObject({ status: "done", sent: 100, fileId: "file-a" });
  });

  it("keeps the error code, and a retry starts from the beginning", () => {
    let state = run([
      { type: "add", uploads: [upload("a")] },
      { type: "started", id: "a" },
      { type: "progress", id: "a", sent: 40 },
      { type: "failed", id: "a", code: "quota_exceeded" },
    ]);
    expect(state.items[0]).toMatchObject({ status: "error", error: "quota_exceeded", sent: 40 });
    state = run([{ type: "retry", id: "a" }], state);
    expect(state.items[0]).toMatchObject({ status: "queued", error: null, sent: 0 });
  });

  it("ignores a late result after the upload was cancelled", () => {
    const state = run([
      { type: "add", uploads: [upload("a")] },
      { type: "started", id: "a" },
      { type: "cancel", id: "a" },
      { type: "succeeded", id: "a", fileId: "x" },
      { type: "failed", id: "a", code: "internal" },
      { type: "progress", id: "a", sent: 70 },
    ]);
    expect(state.items[0]).toMatchObject({ status: "cancelled", sent: 0, error: null });
    expect(state.completed).toBe(0);
  });

  it("cannot cancel or retry a finished upload", () => {
    const state = run([
      { type: "add", uploads: [upload("a")] },
      { type: "started", id: "a" },
      { type: "succeeded", id: "a", fileId: "x" },
      { type: "cancel", id: "a" },
      { type: "retry", id: "a" },
    ]);
    expect(statusOf(state, "a")).toBe("done");
  });

  it("clears finished items but keeps the ones still running", () => {
    const state = run([
      { type: "add", uploads: ["a", "b", "c", "d"].map((id) => upload(id)) },
      { type: "started", id: "a" },
      { type: "succeeded", id: "a", fileId: "x" },
      { type: "started", id: "b" },
      { type: "cancel", id: "c" },
      { type: "clearFinished" },
    ]);
    expect(state.items.map((i) => i.id)).toEqual(["b", "d"]);
  });

  it("dismisses only a finished item", () => {
    const state = run([
      { type: "add", uploads: [upload("a"), upload("b")] },
      { type: "cancel", id: "a" },
      { type: "dismiss", id: "a" },
      { type: "dismiss", id: "b" },
    ]);
    expect(state.items.map((i) => i.id)).toEqual(["b"]);
  });

  describe("summary", () => {
    it("reports counts and a byte-weighted percentage, leaving out cancelled files", () => {
      const state = run([
        { type: "add", uploads: [upload("a", 300), upload("b", 100), upload("c", 999)] },
        { type: "started", id: "a" },
        { type: "succeeded", id: "a", fileId: "x" },
        { type: "started", id: "b" },
        { type: "progress", id: "b", sent: 50 },
        { type: "cancel", id: "c" },
      ]);
      expect(summarize(state.items)).toEqual({
        total: 3,
        done: 1,
        failed: 0,
        cancelled: 1,
        active: 1,
        percent: 87,
      });
    });

    it("is 100 percent when only empty files are done, and 0 while one is waiting", () => {
      const waiting = run([{ type: "add", uploads: [upload("a", 0)] }]);
      expect(summarize(waiting.items).percent).toBe(0);
      const done = run(
        [
          { type: "started", id: "a" },
          { type: "succeeded", id: "a", fileId: null },
        ],
        waiting,
      );
      expect(summarize(done.items).percent).toBe(100);
    });

    it("counts failures separately from active uploads", () => {
      const state = run([
        { type: "add", uploads: [upload("a"), upload("b")] },
        { type: "started", id: "a" },
        { type: "failed", id: "a", code: "internal" },
      ]);
      expect(summarize(state.items)).toMatchObject({ failed: 1, active: 1, done: 0 });
    });
  });

  it("rounds an item's percentage down", () => {
    const [item] = run([
      { type: "add", uploads: [upload("a", 3)] },
      { type: "started", id: "a" },
      { type: "progress", id: "a", sent: 2 },
    ]).items;
    expect(item && itemPercent(item)).toBe(66);
  });
});
