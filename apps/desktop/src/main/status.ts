import { format, type Dictionary } from "../i18n/index.js";
import type { StatusState, StatusView } from "../ipc/types.js";

/** What the shell knows about syncing: the engine's status plus "not set up" and a transfer count. */
export interface ShellStatus {
  state: StatusState;
  /** Why the state is "error": an API error code, an errno, or one of the shell's own codes. */
  code?: string;
  /** Uploads and downloads in flight. */
  active: number;
}

/** Translates a machine code (API error code, errno, engine or shell code) into a sentence. */
export function reasonFor(dict: Dictionary, code: string | undefined): string {
  const reasons: Readonly<Record<string, string>> = dict.reasons;
  if (code !== undefined && Object.hasOwn(reasons, code))
    return reasons[code] ?? dict.reasons.unknown;
  if (code !== undefined && /^http_5\d\d$/.test(code)) return dict.reasons.internal;
  return dict.reasons.unknown;
}

/** The tray's status line. */
export function statusLabel(status: ShellStatus, dict: Dictionary): string {
  switch (status.state) {
    case "unconfigured":
      return dict.tray.statusNotConfigured;
    case "idle":
      return dict.tray.statusIdle;
    case "paused":
      return dict.tray.statusPaused;
    case "offline":
      return dict.tray.statusOffline;
    case "error":
      return format(dict.tray.statusError, { reason: reasonFor(dict, status.code) });
    case "syncing":
      if (status.active <= 0) return dict.tray.statusSyncing;
      if (status.active === 1) return dict.tray.statusSyncingOne;
      return format(dict.tray.statusSyncingMany, { count: status.active });
  }
}

export function statusView(status: ShellStatus, dict: Dictionary): StatusView {
  return { state: status.state, label: statusLabel(status, dict) };
}
