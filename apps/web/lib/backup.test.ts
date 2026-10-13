import { describe, expect, it } from "vitest";
import {
  EXISTS_BATCH,
  MAX_HASH_BYTES,
  chunk,
  hashFile,
  planBackup,
  sha256Of,
  toHex,
  type Hashed,
} from "./backup";

function file(name: string, content = name): File {
  return new File([content], name, { type: "image/jpeg" });
}

function hashed(f: File, sha256: string): Hashed {
  return { file: f, kind: "hashed", sha256 };
}

describe("chunk", () => {
  it("splits into batches of at most the size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  it("keeps the exists batch within what the server accepts", () => {
    expect(EXISTS_BATCH).toBeLessThanOrEqual(1000);
    expect(
      chunk(
        Array.from({ length: 1200 }, (_, i) => i),
        EXISTS_BATCH,
      ).map((b) => b.length),
    ).toEqual([500, 500, 200]);
  });
});

describe("hashing", () => {
  it("writes bytes as lowercase hex", () => {
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe("000fff");
  });

  it("matches a known SHA-256", async () => {
    expect(await sha256Of(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("marks a file over the limit as unchecked without reading it", async () => {
    const big = file("big.mov");
    Object.defineProperty(big, "size", { value: MAX_HASH_BYTES + 1 });
    expect(await hashFile(big)).toEqual({ file: big, kind: "unchecked" });
  });

  it("marks a file the browser cannot read as unreadable", async () => {
    const broken = file("gone.jpg");
    broken.arrayBuffer = () => Promise.reject(new Error("NotReadableError"));
    expect(await hashFile(broken)).toEqual({ file: broken, kind: "unreadable" });
  });
});

describe("planBackup", () => {
  const a = file("a.jpg");
  const b = file("b.jpg");
  const c = file("c.jpg");

  it("uploads only the files the server does not have", () => {
    const plan = planBackup([hashed(a, "h1"), hashed(b, "h2"), hashed(c, "h3")], new Set(["h2"]));
    expect(plan).toEqual({ toUpload: [a, c], alreadyBackedUp: 1, unchecked: 0, unreadable: 0 });
  });

  it("uploads nothing when everything is already backed up", () => {
    const plan = planBackup([hashed(a, "h1"), hashed(b, "h2")], new Set(["h1", "h2"]));
    expect(plan.toUpload).toEqual([]);
    expect(plan.alreadyBackedUp).toBe(2);
  });

  it("uploads one copy of identical files in the same selection", () => {
    const copy = file("a (copy).jpg");
    const plan = planBackup([hashed(a, "h1"), hashed(copy, "h1")], new Set());
    expect(plan.toUpload).toEqual([a]);
    expect(plan.alreadyBackedUp).toBe(1);
  });

  it("uploads unchecked large files and counts unreadable ones apart", () => {
    const plan = planBackup(
      [{ file: a, kind: "unchecked" }, { file: b, kind: "unreadable" }, hashed(c, "h3")],
      new Set(),
    );
    expect(plan).toEqual({ toUpload: [a, c], alreadyBackedUp: 0, unchecked: 1, unreadable: 1 });
  });

  it("does not treat a hash it was not told about as existing", () => {
    expect(planBackup([hashed(a, "h1")], new Set(["other"])).toUpload).toEqual([a]);
  });
});
