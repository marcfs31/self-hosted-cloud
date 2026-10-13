import type { PhotoItem } from "@cloud/shared";
import { describe, expect, it } from "vitest";
import { appendPage, formatMonthYear, groupByMonth, neighbour } from "./photos";

function photo(fileId: string, takenAt: Date): PhotoItem {
  return {
    fileId,
    name: `${fileId}.png`,
    mime: "image/png",
    kind: "image",
    takenAt: takenAt.toISOString(),
    takenAtSource: "exif",
    width: null,
    height: null,
  };
}

// Local-time constructors, so the month a photo lands in does not depend on the test machine's zone.
const oct15 = photo("a", new Date(2026, 9, 15, 12));
const oct02 = photo("b", new Date(2026, 9, 2, 12));
const sep30 = photo("c", new Date(2026, 8, 30, 12));
const sep01 = photo("d", new Date(2026, 8, 1, 12));

describe("groupByMonth", () => {
  it("groups consecutive photos of the same month under one heading, keeping the order", () => {
    const groups = groupByMonth([oct15, oct02, sep30, sep01], "en");
    expect(groups.map((g) => [g.label, g.items.map((i) => i.fileId)])).toEqual([
      ["October 2026", ["a", "b"]],
      ["September 2026", ["c", "d"]],
    ]);
  });

  it("keeps an oldest-first list oldest-first", () => {
    const groups = groupByMonth([sep01, sep30, oct02], "en");
    expect(groups.map((g) => g.label)).toEqual(["September 2026", "October 2026"]);
  });

  it("starts a new group when a month comes back, instead of reordering", () => {
    const groups = groupByMonth([oct15, sep30, oct02], "en");
    expect(groups.map((g) => g.items.map((i) => i.fileId))).toEqual([["a"], ["c"], ["b"]]);
  });

  it("separates the same month of different years", () => {
    const old = photo("e", new Date(2025, 9, 15, 12));
    expect(groupByMonth([oct15, old], "en").map((g) => g.label)).toEqual([
      "October 2026",
      "October 2025",
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(groupByMonth([], "en")).toEqual([]);
  });
});

describe("formatMonthYear", () => {
  it("uses the locale's month name and capitalises the heading", () => {
    const date = new Date(2026, 9, 15, 12);
    expect(formatMonthYear(date, "en")).toBe("October 2026");
    expect(formatMonthYear(date, "es")).toMatch(/^Octubre/);
    expect(formatMonthYear(date, "pt-PT")).toMatch(/^Outubro/);
    expect(formatMonthYear(date, "it")).toMatch(/^Ottobre/);
    expect(formatMonthYear(date, "ca")).toMatch(/^Octubre/);
  });
});

describe("appendPage", () => {
  it("adds a page after the loaded photos", () => {
    expect(appendPage([oct15], [oct02]).map((i) => i.fileId)).toEqual(["a", "b"]);
  });

  it("keeps a photo that appears again only once, and the same array when nothing is new", () => {
    const loaded = [oct15, oct02];
    expect(appendPage(loaded, [oct02, sep30]).map((i) => i.fileId)).toEqual(["a", "b", "c"]);
    expect(appendPage(loaded, [oct02])).toBe(loaded);
  });
});

describe("neighbour", () => {
  const items = [oct15, oct02, sep30];

  it("finds the previous and next photo", () => {
    expect(neighbour(items, "b", -1)?.fileId).toBe("a");
    expect(neighbour(items, "b", 1)?.fileId).toBe("c");
  });

  it("is null at either end and for an unknown id", () => {
    expect(neighbour(items, "a", -1)).toBeNull();
    expect(neighbour(items, "c", 1)).toBeNull();
    expect(neighbour(items, "zzz", 1)).toBeNull();
  });
});
