import { describe, expect, it } from "vitest";
import { CliError } from "./errors.js";
import { formatPath } from "./format.js";
import { parseRemotePath } from "./paths.js";

describe("parseRemotePath", () => {
  it("treats / and the empty string as the root", () => {
    expect(parseRemotePath("/")).toEqual([]);
    expect(parseRemotePath("")).toEqual([]);
    expect(parseRemotePath("///")).toEqual([]);
  });

  it("splits names and ignores leading, trailing and doubled slashes", () => {
    expect(parseRemotePath("/a/b/c")).toEqual(["a", "b", "c"]);
    expect(parseRemotePath("a//b/")).toEqual(["a", "b"]);
  });

  it("ignores '.' segments", () => {
    expect(parseRemotePath("/a/./b")).toEqual(["a", "b"]);
  });

  it("refuses '..' as a usage error", () => {
    expect(() => parseRemotePath("/a/../b")).toThrow(CliError);
    try {
      parseRemotePath("../x");
    } catch (err) {
      expect(err).toMatchObject({ exitCode: 1, code: "usage" });
    }
  });

  it("normalizes names to NFC like the server", () => {
    expect(parseRemotePath("/café")).toEqual(["café"]);
  });

  it("keeps spaces and dots inside names", () => {
    expect(parseRemotePath("/My Files/report v1.2.pdf")).toEqual(["My Files", "report v1.2.pdf"]);
  });

  it("round-trips through formatPath", () => {
    expect(formatPath(parseRemotePath("a/b"))).toBe("/a/b");
    expect(formatPath([])).toBe("/");
  });
});
