import { describe, expect, it } from "vitest";
import { healthResponse } from "./health.js";

describe("healthResponse", () => {
  it("accepts a valid payload", () => {
    expect(healthResponse.parse({ status: "ok", version: "1.2.3" })).toEqual({
      status: "ok",
      version: "1.2.3",
    });
  });

  it("rejects an unknown status", () => {
    expect(healthResponse.safeParse({ status: "fine", version: "1" }).success).toBe(false);
  });
});
