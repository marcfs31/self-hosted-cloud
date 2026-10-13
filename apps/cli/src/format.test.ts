import { describe, expect, it } from "vitest";
import { formatBytes, table } from "./format.js";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KiB"],
    [1536, "1.5 KiB"],
    [3 * 1024 * 1024, "3.0 MiB"],
    [5 * 1024 ** 3, "5.0 GiB"],
    [1024 ** 4, "1.0 TiB"],
    [1024 * 1024 - 1, "1.0 MiB"],
  ])("%d bytes is %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("table", () => {
  it("pads columns, right-aligns where asked and leaves no trailing blanks", () => {
    const text = table(
      [
        ["file", "5 B", "a.txt"],
        ["folder", "-", "dir/"],
      ],
      ["left", "right", "left"],
    );
    expect(text).toBe("file    5 B  a.txt\nfolder    -  dir/");
  });
});
