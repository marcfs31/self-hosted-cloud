import { describe, expect, it } from "vitest";
import { safeNextPath } from "./session";

describe("safeNextPath", () => {
  it("keeps same-site paths, with query and fragment", () => {
    expect(safeNextPath("/files/abc")).toBe("/files/abc");
    expect(safeNextPath("/photos?album=1#top")).toBe("/photos?album=1#top");
    expect(safeNextPath("/")).toBe("/");
  });

  it("falls back to / for anything that is not a path", () => {
    for (const next of [null, "", "files", "https://evil.example/", "javascript:alert(1)"]) {
      expect(safeNextPath(next), String(next)).toBe("/");
    }
  });

  it("refuses protocol-relative and backslash forms", () => {
    for (const next of [
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "///evil.example",
    ]) {
      expect(safeNextPath(next), next).toBe("/");
    }
  });

  it("refuses the forms the URL parser repairs: tab, line feed and carriage return are dropped", () => {
    for (const next of [
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "/\t\\evil.example",
      "/\t\t/evil.example",
    ]) {
      expect(safeNextPath(next), JSON.stringify(next)).toBe("/");
    }
  });

  it("never returns a string that resolves off-site", () => {
    const candidates = ["/a", "/%09/evil.example", "/%2F/evil.example", "/a/../../evil.example"];
    for (const next of candidates) {
      const out = safeNextPath(next);
      expect(new URL(out, "https://cloud.example").origin, next).toBe("https://cloud.example");
    }
  });
});
