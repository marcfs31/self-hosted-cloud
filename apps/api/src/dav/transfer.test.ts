import { readdirSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { davSetup as setup } from "../testing/dav.js";

const OPEN_DELAY_MS = 50;

// Opening a WebDAV temp file is slowed down so a body refused on its first chunk is refused
// while the open is still pending: the case where the temp file could outlive its cleanup.
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const slowOpen = (...args: Parameters<typeof real.open>): void => {
    setTimeout(() => {
      real.open(...args);
    }, OPEN_DELAY_MS);
  };
  return {
    ...real,
    createWriteStream: (
      path: Parameters<typeof real.createWriteStream>[0],
      options?: Parameters<typeof real.createWriteStream>[1],
    ) =>
      String(path).includes(`${sep}tmp${sep}dav${sep}`) && typeof options === "object"
        ? real.createWriteStream(path, { ...options, fs: { ...real, open: slowOpen } })
        : real.createWriteStream(path, options),
  };
});

describe("a refused WebDAV upload", () => {
  it("leaves no temp file behind, even when refused before the file is open", async () => {
    const { h, a, da } = await setup();
    h.setQuota(a.user.id, 10);
    const server = h.app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            port,
            method: "PUT",
            path: "/dav/streamed.bin",
            headers: {
              Authorization: `Basic ${Buffer.from(`${a.email}:${da.secret}`).toString("base64")}`,
              "Transfer-Encoding": "chunked",
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end(Buffer.alloc(40));
      });
      expect(status).toBe(507);
    } finally {
      server.close();
    }
    await sleep(OPEN_DELAY_MS * 3);
    expect(readdirSync(join(h.dataDir, "tmp", "dav"))).toEqual([]);
  });
});
