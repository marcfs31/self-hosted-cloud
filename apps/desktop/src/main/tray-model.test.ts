import { describe, expect, it } from "vitest";
import { dictionaries } from "../i18n/index.js";
import type { ShellStatus } from "./status.js";
import { trayModel, trayTooltip, type TrayItem } from "./tray-model.js";

const en = dictionaries.en;
const status = (state: ShellStatus["state"], extra: Partial<ShellStatus> = {}): ShellStatus => ({
  state,
  active: 0,
  ...extra,
});

const action = (items: TrayItem[], name: string): TrayItem | undefined =>
  items.find((i) => i.kind === "action" && i.action === name);

describe("trayModel", () => {
  it("starts with the status line and ends with Settings and Quit", () => {
    const items = trayModel(status("idle"), en);
    expect(items[0]).toEqual({ kind: "status", label: "Up to date" });
    expect(items.at(-2)).toMatchObject({ action: "settings", enabled: true });
    expect(items.at(-1)).toMatchObject({ action: "quit", enabled: true });
  });

  it("offers Pause while syncing and Resume while paused", () => {
    expect(action(trayModel(status("syncing", { active: 2 }), en), "toggle-pause")).toMatchObject({
      label: "Pause syncing",
    });
    expect(action(trayModel(status("paused"), en), "toggle-pause")).toMatchObject({
      label: "Resume syncing",
      enabled: true,
    });
  });

  it("disables folder, browser and pause until an account is set up", () => {
    const items = trayModel(status("unconfigured"), en);
    for (const name of ["open-folder", "open-browser", "toggle-pause"]) {
      expect(action(items, name), name).toMatchObject({ enabled: false });
    }
    expect(items[0]).toEqual({ kind: "status", label: "Not set up yet" });
  });

  it("keeps the folder and browser reachable in an error or offline state", () => {
    for (const s of [status("error", { code: "unauthenticated" }), status("offline")]) {
      expect(action(trayModel(s, en), "open-folder")).toMatchObject({ enabled: true });
      expect(action(trayModel(s, en), "open-browser")).toMatchObject({ enabled: true });
    }
  });

  it("puts the status in the tooltip", () => {
    expect(trayTooltip(status("offline"), en)).toBe("Cloud: Offline");
  });
});
