import { afterEach, describe, expect, it, vi } from "vitest";
import { searchFiles, searchHref } from "./search-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchHref", () => {
  it("encodes the query", () => {
    expect(searchHref("annual report")).toBe("/search?q=annual%20report");
    expect(searchHref("a&b=c#d")).toBe("/search?q=a%26b%3Dc%23d");
  });

  it("trims, and falls back to the bare search page", () => {
    expect(searchHref("  notes  ")).toBe("/search?q=notes");
    expect(searchHref("   ")).toBe("/search");
    expect(searchHref("")).toBe("/search");
  });
});

describe("searchFiles", () => {
  it("asks the API with the query and limit and returns its results", async () => {
    const fn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fn);
    await expect(searchFiles("a&b c")).resolves.toEqual({ results: [] });
    expect(fn.mock.calls[0]?.[0]).toBe("/api/search?q=a%26b+c&limit=50");
  });
});
