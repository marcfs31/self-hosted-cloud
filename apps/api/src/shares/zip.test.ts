import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamZip, type ZipEntry } from "./zip.js";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function serve(entries: ZipEntry[]): Promise<string> {
  const app = express();
  app.get("/zip", (_req, res, next) => {
    streamZip(res, "test", entries).catch(next);
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/zip`;
}

function blob(dir: string, name: string, bytes: Buffer) {
  const file = join(dir, name);
  writeFileSync(file, bytes);
  return { file, size: bytes.length };
}

describe("streamZip failure handling", () => {
  it("completes when every blob is readable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-ok-"));
    const url = await serve([
      {
        path: "a.bin",
        kind: "file",
        blob: blob(dir, "a", Buffer.alloc(200_000, 1)),
        mtime: new Date(),
      },
    ]);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(Number(res.headers.get("content-length")));
  });

  it("aborts the connection when a blob is missing at the start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-missing-"));
    const url = await serve([
      {
        path: "a.bin",
        kind: "file",
        blob: { file: join(dir, "nope"), size: 10 },
        mtime: new Date(),
      },
    ]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(fetch(url).then((r) => r.arrayBuffer())).rejects.toThrow();
    } finally {
      error.mockRestore();
    }
  });

  it("aborts mid-stream when a later blob fails: the partial body never looks complete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-mid-"));
    const url = await serve([
      {
        path: "a.bin",
        kind: "file",
        blob: blob(dir, "a", Buffer.alloc(500_000, 7)),
        mtime: new Date(),
      },
      {
        path: "b.bin",
        kind: "file",
        blob: { file: join(dir, "nope"), size: 10 },
        mtime: new Date(),
      },
    ]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(fetch(url).then((r) => r.arrayBuffer())).rejects.toThrow();
      expect(error).toHaveBeenCalledWith("zip stream failed:", "ENOENT");
    } finally {
      error.mockRestore();
    }
  });

  it("aborts when a blob is shorter than the database says", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-short-"));
    const short = blob(dir, "a", Buffer.alloc(1000, 1));
    const url = await serve([
      { path: "a.bin", kind: "file", blob: { file: short.file, size: 5000 }, mtime: new Date() },
    ]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(fetch(url).then((r) => r.arrayBuffer())).rejects.toThrow();
    } finally {
      error.mockRestore();
    }
  });
});
