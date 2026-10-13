import { errorCode } from "@cloud/shared";
import { describe, expect, it } from "vitest";
import { apiError } from "./errors.js";

describe("apiError", () => {
  it("has plain English for every API error code", () => {
    for (const code of errorCode.options) {
      const err = apiError(400, code);
      expect(err.message).toMatch(/^[A-Z].*[.)]$/);
      expect(err.code).toBe(code);
    }
  });

  it.each([
    ["unauthenticated", 2],
    ["not_found", 3],
    ["name_conflict", 4],
    ["invalid_move", 4],
    ["quota_exceeded", 5],
    ["internal", 10],
    ["invalid_request", 1],
  ] as const)("maps %s to exit %d", (code, exit) => {
    expect(apiError(400, code).exitCode).toBe(exit);
  });

  it("falls back to the HTTP status when the body had no code", () => {
    expect(apiError(401, undefined).exitCode).toBe(2);
    expect(apiError(404, undefined).exitCode).toBe(3);
    expect(apiError(409, undefined).exitCode).toBe(4);
    expect(apiError(413, undefined).exitCode).toBe(5);
    expect(apiError(502, undefined).exitCode).toBe(10);
    expect(apiError(502, undefined).message).toContain("502");
  });
});
