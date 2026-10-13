import { describe, expect, it } from "vitest";
import { packIco } from "./ico.ts";

const png = (extra: number): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra, 7),
  ]);

describe("packIco", () => {
  it("writes the header, one directory entry per image and the images back to back", () => {
    const small = png(10);
    const large = png(30);
    const ico = packIco([
      { size: 16, png: small },
      { size: 256, png: large },
    ]);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    const first = 6;
    const second = 22;
    expect([ico[first], ico[first + 1]]).toEqual([16, 16]);
    expect(ico.readUInt16LE(first + 6)).toBe(32);
    expect(ico.readUInt32LE(first + 8)).toBe(small.length);
    expect(ico.readUInt32LE(first + 12)).toBe(38);
    expect([ico[second], ico[second + 1]]).toEqual([0, 0]); // 256 is stored as 0
    expect(ico.readUInt32LE(second + 8)).toBe(large.length);
    expect(ico.readUInt32LE(second + 12)).toBe(38 + small.length);
    expect(ico.length).toBe(38 + small.length + large.length);
    expect(ico.subarray(38, 38 + small.length).equals(small)).toBe(true);
    expect(ico.subarray(38 + small.length).equals(large)).toBe(true);
  });

  it("refuses an empty list, sizes over 256 and anything that is not a PNG", () => {
    expect(() => packIco([])).toThrow(/1 to 65535/);
    expect(() => packIco([{ size: 512, png: png(1) }])).toThrow(/256/);
    expect(() => packIco([{ size: 32, png: Buffer.from("GIF89a") }])).toThrow(/PNG/);
  });
});
