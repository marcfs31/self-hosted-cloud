import type { Dictionary } from "../i18n/index.js";
import { format } from "../i18n/index.js";
import { statusLabel, type ShellStatus } from "./status.js";

export type TrayAction = "open-folder" | "open-browser" | "toggle-pause" | "settings" | "quit";

export type TrayItem =
  | { kind: "status"; label: string }
  | { kind: "action"; action: TrayAction; label: string; enabled: boolean }
  | { kind: "separator" };

/**
 * The tray menu as data, so it can be tested without Electron. Folder, browser and pause need a
 * configured account; Settings and Quit are always available.
 */
export function trayModel(status: ShellStatus, dict: Dictionary): TrayItem[] {
  const configured = status.state !== "unconfigured";
  const paused = status.state === "paused";
  return [
    { kind: "status", label: statusLabel(status, dict) },
    { kind: "separator" },
    { kind: "action", action: "open-folder", label: dict.tray.openFolder, enabled: configured },
    { kind: "action", action: "open-browser", label: dict.tray.openBrowser, enabled: configured },
    {
      kind: "action",
      action: "toggle-pause",
      label: paused ? dict.tray.resume : dict.tray.pause,
      enabled: configured,
    },
    { kind: "separator" },
    { kind: "action", action: "settings", label: dict.tray.settings, enabled: true },
    { kind: "action", action: "quit", label: dict.tray.quit, enabled: true },
  ];
}

export function trayTooltip(status: ShellStatus, dict: Dictionary): string {
  return format(dict.tray.tooltip, { status: statusLabel(status, dict) });
}
