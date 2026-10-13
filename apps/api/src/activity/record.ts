import type { ActivityType } from "@cloud/shared";
import type { Db } from "../db/client.js";
import { activity } from "../db/schema/index.js";

export interface ActivityInput {
  userId: string;
  type: ActivityType;
  fileId?: string | undefined;
  /** Small, non-secret context (a file or device name). Never tokens, passwords or codes. */
  detail?: Record<string, string> | undefined;
  ip?: string | undefined;
  /** Epoch ms; defaults to the wall clock. Callers with an injected clock pass it. */
  at?: number | undefined;
}

/**
 * Appends one event. Call it with the transaction that performs the action, so the log can
 * never say something happened that rolled back (or miss something that committed).
 */
export function recordActivity(tx: Pick<Db, "insert">, input: ActivityInput): void {
  tx.insert(activity)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      type: input.type,
      fileId: input.fileId ?? null,
      detail: JSON.stringify(input.detail ?? {}),
      ip: input.ip ?? null,
      createdAt: new Date(input.at ?? Date.now()),
    })
    .run();
}
