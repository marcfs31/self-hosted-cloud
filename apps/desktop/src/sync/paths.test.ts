import { describe, expect, it } from "vitest";
import { isIgnoredName, isIgnoredPath } from "./ignore.js";
import { baseOf, conflictedName, depthOf, isUnder, parentOf, replacePrefix } from "./paths.js";

describe("conflictedName", () => {
  const at = new Date(2026, 9, 13, 4, 5);
  it("puts the device and local time before the extension", () => {
    expect(conflictedName("report.pdf", "MacBook", at)).toBe(
      "report (conflicted copy MacBook 2026-10-13 04-05).pdf",
    );
  });
  it("handles no extension, dotfiles and multiple dots", () => {
    expect(conflictedName("Makefile", "PC", at)).toBe(
      "Makefile (conflicted copy PC 2026-10-13 04-05)",
    );
    expect(conflictedName(".env", "PC", at)).toBe(".env (conflicted copy PC 2026-10-13 04-05)");
    expect(conflictedName("a.tar.gz", "PC", at)).toBe(
      "a.tar (conflicted copy PC 2026-10-13 04-05).gz",
    );
  });
  it("replaces characters a device name cannot carry into a file name", () => {
    expect(conflictedName("a.txt", "Marc's/PC:1", at)).toBe(
      "a (conflicted copy Marc's-PC-1 2026-10-13 04-05).txt",
    );
  });
  it("never exceeds 255 characters", () => {
    const long = `${"x".repeat(300)}.txt`;
    expect(conflictedName(long, "PC", at).length).toBeLessThanOrEqual(255);
    expect(conflictedName(long, "PC", at).endsWith(").txt")).toBe(true);
  });
});

describe("ignore rules", () => {
  it.each([
    ".DS_Store",
    "Thumbs.db",
    "thumbs.db",
    "desktop.ini",
    "Desktop.ini",
    "._x",
    "~$a.docx",
    "a.tmp",
    "A.TMP",
    ".cloud-tmp-1",
  ])("ignores %s", (name) => {
    expect(isIgnoredName(name)).toBe(true);
  });
  it.each(["a.txt", "tmp", "atmp", "x.tmpl", "~notlock", ".gitignore", "._", "DS_Store"])(
    "keeps %s",
    (name) => {
      expect(isIgnoredName(name)).toBe(name === "._");
    },
  );
  it("ignores everything under an ignored folder", () => {
    expect(isIgnoredPath("a/b.tmp/c.txt")).toBe(true);
    expect(isIgnoredPath("a/b/c.txt")).toBe(false);
  });
});

describe("path helpers", () => {
  it("splits, nests and rebases", () => {
    expect(parentOf("a/b/c")).toBe("a/b");
    expect(parentOf("a")).toBe("");
    expect(baseOf("a/b/c")).toBe("c");
    expect(depthOf("a/b/c")).toBe(3);
    expect(isUnder("a/b", "a")).toBe(true);
    expect(isUnder("ab/c", "a")).toBe(false);
    expect(isUnder("a", "")).toBe(true);
    expect(replacePrefix("a/b/c", "a/b", "x")).toBe("x/c");
    expect(replacePrefix("a/b", "a/b", "x")).toBe("x");
  });
});
