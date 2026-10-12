import { describe, expect, it } from "vitest";
import { healthResponse } from "./health.js";

describe("healthResponse", () => {
  it("accepts a valid payload", () => {
    const body = { status: "ok", version: "1.2.3", checks: { storage: "ok" } };
    expect(healthResponse.parse(body)).toEqual(body);
  });

  it("rejects an unknown status", () => {
    const body = { status: "fine", version: "1", checks: { storage: "ok" } };
    expect(healthResponse.safeParse(body).success).toBe(false);
  });
});
