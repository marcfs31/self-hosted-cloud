import { describe, expect, it } from "vitest";
import {
  currentConflict,
  isResolved,
  planUploads,
  resolveConflict,
  startConflicts,
  undecidedCount,
  type Conflict,
} from "./upload-conflicts";

const a: Conflict = { key: "a", canReplace: true };
const b: Conflict = { key: "b", canReplace: true };
const folder: Conflict = { key: "f", canReplace: false };

describe("upload conflicts", () => {
  it("asks about conflicts one at a time, in order", () => {
    let state = startConflicts([a, b]);
    expect(currentConflict(state)).toEqual(a);
    expect(undecidedCount(state)).toBe(2);
    state = resolveConflict(state, "skip", false);
    expect(currentConflict(state)).toEqual(b);
    expect(undecidedCount(state)).toBe(1);
    expect(isResolved(state)).toBe(false);
    state = resolveConflict(state, "replace", false);
    expect(isResolved(state)).toBe(true);
    expect(state.decided).toEqual({ a: "skip", b: "replace" });
  });

  it("applies one answer to every remaining conflict, and not to ones already answered", () => {
    let state = startConflicts([a, b, folder]);
    state = resolveConflict(state, "skip", false);
    state = resolveConflict(state, "keepBoth", true);
    expect(isResolved(state)).toBe(true);
    expect(state.decided).toEqual({ a: "skip", b: "keepBoth", f: "keepBoth" });
  });

  it("never replaces a folder: it keeps both instead", () => {
    const state = resolveConflict(startConflicts([folder, a]), "replace", true);
    expect(state.decided).toEqual({ f: "keepBoth", a: "replace" });
  });

  it("does nothing once every conflict is answered", () => {
    const done = resolveConflict(startConflicts([a]), "replace", false);
    expect(resolveConflict(done, "skip", true)).toBe(done);
  });

  it("is settled at once when there are no conflicts", () => {
    expect(isResolved(startConflicts([]))).toBe(true);
  });

  it("plans replace with the existing ID, keep both without, and drops skipped files", () => {
    const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
    const existing: Record<string, string> = { a: "id-a", b: "id-b", c: "id-c" };
    let state = startConflicts([
      { key: "a", canReplace: true },
      { key: "b", canReplace: true },
      { key: "c", canReplace: true },
    ]);
    state = resolveConflict(state, "replace", false);
    state = resolveConflict(state, "keepBoth", false);
    state = resolveConflict(state, "skip", false);
    const plan = planUploads(items, (item) => existing[item.key] ?? null, state);
    expect(plan.map((p) => [p.item.key, p.replaceId])).toEqual([
      ["a", "id-a"],
      ["b", null],
      ["d", null],
    ]);
  });
});
