import { describe, expect, it } from "vitest";
import { changePasswordRequest } from "./auth.js";
import {
  activityType,
  createAppPasswordRequest,
  registerPasskeyRequest,
  SECURITY_ACTIVITY_TYPES,
} from "./security.js";

describe("step-up fields", () => {
  it("createAppPasswordRequest needs the password; the code is optional", () => {
    expect(createAppPasswordRequest.safeParse({ name: "cli" }).success).toBe(false);
    expect(createAppPasswordRequest.safeParse({ name: "cli", password: "" }).success).toBe(false);
    expect(createAppPasswordRequest.parse({ name: "cli", password: "pw" })).toEqual({
      name: "cli",
      password: "pw",
    });
    expect(
      createAppPasswordRequest.parse({ name: "cli", password: "pw", code: " 123456 " }),
    ).toEqual({
      name: "cli",
      password: "pw",
      code: "123456",
    });
    expect(
      createAppPasswordRequest.safeParse({ name: "cli", password: "pw", code: "12" }).success,
    ).toBe(false);
  });

  it("registerPasskeyRequest needs the password", () => {
    expect(registerPasskeyRequest.safeParse({ name: "Laptop", response: {} }).success).toBe(false);
    expect(
      registerPasskeyRequest.safeParse({ name: "Laptop", response: {}, password: "pw" }).success,
    ).toBe(true);
  });
});

describe("changePasswordRequest", () => {
  it("applies the new-password rules", () => {
    expect(
      changePasswordRequest.safeParse({ currentPassword: "old", newPassword: "x".repeat(12) })
        .success,
    ).toBe(true);
    expect(
      changePasswordRequest.safeParse({ currentPassword: "old", newPassword: "x".repeat(11) })
        .success,
    ).toBe(false);
    expect(
      changePasswordRequest.safeParse({ currentPassword: "", newPassword: "x".repeat(12) }).success,
    ).toBe(false);
  });
});

describe("password_changed", () => {
  it("is an activity type and a security event admins see", () => {
    expect(activityType.safeParse("password_changed").success).toBe(true);
    expect(SECURITY_ACTIVITY_TYPES).toContain("password_changed");
  });
});
