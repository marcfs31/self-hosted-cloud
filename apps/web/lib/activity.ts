import type { ActivityEvent, ActivityType } from "@cloud/shared";

export type DetailKind = "method" | "file" | "passkey" | "appPassword" | "by";

export interface DetailLine {
  kind: DetailKind;
  value: string;
}

const FILE_TYPES: readonly ActivityType[] = [
  "upload",
  "trash",
  "restore",
  "purge",
  "share_created",
  "share_revoked",
];

/**
 * The small facts worth showing next to an event, as data the view words in the current
 * locale. Only keys this version knows are used, so a newer server's extras are ignored.
 */
export function detailLines(event: Pick<ActivityEvent, "type" | "detail">): DetailLine[] {
  const { type, detail } = event;
  const lines: DetailLine[] = [];
  const method = detail["method"];
  if (method && (type === "login_succeeded" || type === "login_failed")) {
    lines.push({ kind: "method", value: method });
  }
  const name = detail["name"];
  if (name) {
    if (type === "passkey_added" || type === "passkey_removed") {
      lines.push({ kind: "passkey", value: name });
    } else if (type === "app_password_created" || type === "app_password_revoked") {
      lines.push({ kind: "appPassword", value: name });
    } else if (FILE_TYPES.includes(type)) {
      lines.push({ kind: "file", value: name });
    }
  }
  const passkey = detail["passkey"];
  if (passkey && type === "login_succeeded") {
    lines.push({ kind: "passkey", value: passkey });
  }
  const by = detail["by"];
  if (by && type === "mfa_reset_by_admin") {
    lines.push({ kind: "by", value: by });
  }
  return lines;
}
