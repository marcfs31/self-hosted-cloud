import { describe, expect, it } from "vitest";
import { dictionaries } from "../i18n/index.js";
import { reasonFor, statusLabel, statusView, type ShellStatus } from "./status.js";

const en = dictionaries.en;
const pt = dictionaries["pt-PT"];
const at = (state: ShellStatus["state"], extra: Partial<ShellStatus> = {}): ShellStatus => ({
  state,
  active: 0,
  ...extra,
});

describe("statusLabel (status → tray label)", () => {
  it("maps every state", () => {
    expect(statusLabel(at("idle"), en)).toBe("Up to date");
    expect(statusLabel(at("paused"), en)).toBe("Paused");
    expect(statusLabel(at("offline"), en)).toBe("Offline");
    expect(statusLabel(at("unconfigured"), en)).toBe("Not set up yet");
  });

  it("counts the files in flight while syncing", () => {
    expect(statusLabel(at("syncing"), en)).toBe("Syncing…");
    expect(statusLabel(at("syncing", { active: 1 }), en)).toBe("Syncing 1 file");
    expect(statusLabel(at("syncing", { active: 12 }), en)).toBe("Syncing 12 files");
  });

  it("states the reason for an error", () => {
    expect(statusLabel(at("error", { code: "unauthenticated" }), en)).toBe(
      `Error: ${en.reasons.unauthenticated}`,
    );
    expect(statusLabel(at("error", { code: "ENOSPC" }), en)).toBe("Error: The disk is full.");
    expect(statusLabel(at("error", { code: "account_changed" }), en)).toContain(
      "different account",
    );
  });

  it("falls back to a generic reason for an unknown code instead of showing the code", () => {
    expect(statusLabel(at("error", { code: "wat" }), en)).toBe(`Error: ${en.reasons.unknown}`);
    expect(statusLabel(at("error"), en)).toBe(`Error: ${en.reasons.unknown}`);
  });

  it("maps server failures by HTTP status family", () => {
    expect(reasonFor(en, "http_502")).toBe(en.reasons.internal);
    expect(reasonFor(en, "http_418")).toBe(en.reasons.unknown);
  });

  it("does not read inherited object keys as reasons", () => {
    expect(reasonFor(en, "constructor")).toBe(en.reasons.unknown);
    expect(reasonFor(en, "__proto__")).toBe(en.reasons.unknown);
  });

  it("is translated", () => {
    expect(statusLabel(at("idle"), pt)).toBe("Tudo atualizado");
    expect(statusLabel(at("syncing", { active: 3 }), pt)).toBe("A sincronizar 3 ficheiros");
  });

  it("builds the view the settings window shows", () => {
    expect(statusView(at("paused"), en)).toEqual({ state: "paused", label: "Paused" });
  });
});
