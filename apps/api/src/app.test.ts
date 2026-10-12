import request from "supertest";
import { describe, expect, it } from "vitest";
import { healthResponse } from "@cloud/shared";
import { createApp } from "./app.js";

describe("GET /api/health", () => {
  it("reports ok with the running version", async () => {
    const res = await request(createApp({ version: "9.9.9" })).get("/api/health");
    expect(res.status).toBe(200);
    expect(healthResponse.parse(res.body)).toEqual({ status: "ok", version: "9.9.9" });
  });
});
