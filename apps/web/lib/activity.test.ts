import { describe, expect, it } from "vitest";
import { detailLines } from "./activity";

describe("detailLines", () => {
  it("names the sign-in method and the passkey used", () => {
    expect(
      detailLines({ type: "login_succeeded", detail: { method: "passkey", passkey: "Laptop" } }),
    ).toEqual([
      { kind: "method", value: "passkey" },
      { kind: "passkey", value: "Laptop" },
    ]);
    expect(detailLines({ type: "login_failed", detail: { method: "totp" } })).toEqual([
      { kind: "method", value: "totp" },
    ]);
  });

  it("labels a name by what it names", () => {
    expect(detailLines({ type: "passkey_added", detail: { name: "Phone" } })).toEqual([
      { kind: "passkey", value: "Phone" },
    ]);
    expect(detailLines({ type: "app_password_revoked", detail: { name: "Sync" } })).toEqual([
      { kind: "appPassword", value: "Sync" },
    ]);
    expect(detailLines({ type: "upload", detail: { name: "report.pdf" } })).toEqual([
      { kind: "file", value: "report.pdf" },
    ]);
  });

  it("shows who reset the second factor", () => {
    expect(
      detailLines({ type: "mfa_reset_by_admin", detail: { by: "admin@example.test" } }),
    ).toEqual([{ kind: "by", value: "admin@example.test" }]);
  });

  it("ignores keys that mean nothing for the event, and events with no detail", () => {
    expect(detailLines({ type: "logout", detail: { name: "x", method: "password" } })).toEqual([]);
    expect(detailLines({ type: "totp_enabled", detail: {} })).toEqual([]);
    expect(detailLines({ type: "upload", detail: { secret: "x" } })).toEqual([]);
  });
});
