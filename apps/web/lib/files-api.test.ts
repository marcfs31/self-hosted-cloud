import { afterEach, describe, expect, it, vi } from "vitest";
import { getTextPreview } from "./files-api";
import { TEXT_PREVIEW_BYTES } from "./preview";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: Uint8Array<ArrayBuffer>, status = 206) {
  const fn = vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status })));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("getTextPreview", () => {
  it("asks for the first MiB only", async () => {
    const fn = stubFetch(new TextEncoder().encode("hello"));
    await getTextPreview("f 1", 5);
    const [url, init] = fn.mock.calls[0] ?? [];
    expect(url).toBe("/api/files/f%201/content");
    expect(new Headers(init?.headers).get("range")).toBe(`bytes=0-${TEXT_PREVIEW_BYTES - 1}`);
  });

  it("reads a small file whole", async () => {
    stubFetch(new TextEncoder().encode("hello"));
    await expect(getTextPreview("f", 5)).resolves.toEqual({ text: "hello", truncated: false });
  });

  it("says a file is cut when the server honoured the range and the file is larger", async () => {
    stubFetch(new Uint8Array(TEXT_PREVIEW_BYTES).fill(97));
    const preview = await getTextPreview("f", TEXT_PREVIEW_BYTES + 1);
    expect(preview.text).toHaveLength(TEXT_PREVIEW_BYTES);
    expect(preview.truncated).toBe(true);
  });

  it("says a file is cut when the server ignored the range and sent everything", async () => {
    stubFetch(new Uint8Array(TEXT_PREVIEW_BYTES + 10).fill(97), 200);
    const preview = await getTextPreview("f", TEXT_PREVIEW_BYTES + 10);
    expect(preview.text).toHaveLength(TEXT_PREVIEW_BYTES);
    expect(preview.truncated).toBe(true);
  });

  it("is not cut when the file is exactly one MiB", async () => {
    stubFetch(new Uint8Array(TEXT_PREVIEW_BYTES).fill(97));
    await expect(getTextPreview("f", TEXT_PREVIEW_BYTES)).resolves.toMatchObject({
      truncated: false,
    });
  });
});
