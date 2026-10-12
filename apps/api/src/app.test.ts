import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { healthResponse } from "@cloud/shared";
import { createApp } from "./app.js";
import type { Config } from "./config.js";

const config = (dataDir: string): Config => ({
  production: false,
  port: 0,
  dataDir,
  publicOrigin: "http://localhost:3000",
});

describe("GET /api/health", () => {
  it("reports ok when the data directory is writable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-health-"));
    const res = await request(createApp({ config: config(dir), version: "9.9.9" })).get(
      "/api/health",
    );
    expect(res.status).toBe(200);
    expect(healthResponse.parse(res.body)).toEqual({
      status: "ok",
      version: "9.9.9",
      checks: { storage: "ok" },
    });
  });

  it("reports degraded with 503 when the data directory is missing", async () => {
    const res = await request(
      createApp({ config: config("/nonexistent/cloud-data"), version: "9.9.9" }),
    ).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "degraded", checks: { storage: "unavailable" } });
  });
});
