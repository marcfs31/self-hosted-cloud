import { describe, expect, it } from "vitest";
import type { FileNode } from "@cloud/shared";
import { isPreviewable, previewKind, previewSet, readTextPreview, stepIndex } from "./preview";

function node(id: string, mime: string | null, kind: FileNode["kind"] = "file"): FileNode {
  return {
    id,
    parentId: "root",
    name: id,
    kind,
    size: 1,
    mime,
    currentVersionId: kind === "file" ? "v" : null,
    versionCount: kind === "file" ? 1 : 0,
    createdAt: "2026-10-13T10:00:00.000Z",
    updatedAt: "2026-10-13T10:00:00.000Z",
    deletedAt: null,
  };
}

function streamOf(...chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
  );
}

const encode = (text: string) => new TextEncoder().encode(text);

describe("previewKind", () => {
  it.each([
    ["image/png", "image"],
    ["image/avif", "image"],
    ["video/webm", "video"],
    ["audio/ogg", "audio"],
    ["application/pdf", "pdf"],
    ["text/plain", "text"],
    ["text/markdown", "text"],
    ["application/json", "text"],
    ["text/csv", "text"],
    ["text/plain; charset=utf-8", "text"],
    ["IMAGE/PNG", "image"],
  ] as const)("shows %s as %s", (mime, kind) => {
    expect(previewKind(mime)).toBe(kind);
  });

  it.each([
    "text/html",
    "image/svg+xml",
    "application/octet-stream",
    "application/zip",
    "video/quicktime",
    "toString",
    "",
  ])("never shows %s", (mime) => {
    expect(previewKind(mime)).toBe("none");
  });

  it("has nothing to show without a type", () => {
    expect(previewKind(null)).toBe("none");
  });
});

describe("isPreviewable and previewSet", () => {
  const nodes = [
    node("folder", null, "folder"),
    node("a.png", "image/png"),
    node("b.zip", "application/zip"),
    node("c.txt", "text/plain"),
  ];

  it("accepts only files of a previewable type", () => {
    expect(nodes.map(isPreviewable)).toEqual([false, true, false, true]);
  });

  it("steps through the previewable files in order", () => {
    expect(previewSet(nodes, "a.png").map((n) => n.id)).toEqual(["a.png", "c.txt"]);
  });

  it("keeps a start file that is not previewable, but never a folder", () => {
    expect(previewSet(nodes, "b.zip").map((n) => n.id)).toEqual(["a.png", "b.zip", "c.txt"]);
    expect(previewSet(nodes, "folder").map((n) => n.id)).toEqual(["a.png", "c.txt"]);
  });
});

describe("stepIndex", () => {
  it("moves within the list and stops at both ends", () => {
    expect(stepIndex(1, 3, 1)).toBe(2);
    expect(stepIndex(1, 3, -1)).toBe(0);
    expect(stepIndex(2, 3, 1)).toBeNull();
    expect(stepIndex(0, 3, -1)).toBeNull();
    expect(stepIndex(0, 1, 1)).toBeNull();
  });
});

describe("readTextPreview", () => {
  it("reads a short file whole", async () => {
    await expect(readTextPreview(streamOf(encode("hello ✓")))).resolves.toEqual({
      text: "hello ✓",
      truncated: false,
    });
  });

  it("reads an empty body", async () => {
    await expect(readTextPreview(new Response(null))).resolves.toEqual({
      text: "",
      truncated: false,
    });
  });

  it("is not truncated when the file ends exactly at the limit", async () => {
    await expect(readTextPreview(streamOf(encode("abcd")), 4)).resolves.toEqual({
      text: "abcd",
      truncated: false,
    });
  });

  it("cuts a longer file at the limit and says so", async () => {
    await expect(readTextPreview(streamOf(encode("abcdef")), 4)).resolves.toEqual({
      text: "abcd",
      truncated: true,
    });
    await expect(
      readTextPreview(streamOf(encode("ab"), encode("cd"), encode("e")), 4),
    ).resolves.toEqual({ text: "abcd", truncated: true });
  });

  it("drops a character cut in half instead of showing a replacement mark", async () => {
    // "é" is two bytes; a limit of 2 keeps "a" and half of "é".
    const result = await readTextPreview(streamOf(encode("aéb")), 2);
    expect(result).toEqual({ text: "a", truncated: true });
  });

  it("joins a character split across chunks", async () => {
    const bytes = encode("é");
    const result = await readTextPreview(streamOf(bytes.subarray(0, 1), bytes.subarray(1)));
    expect(result.text).toBe("é");
  });
});
