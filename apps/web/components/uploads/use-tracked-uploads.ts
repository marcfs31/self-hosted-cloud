"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isActive } from "../../lib/upload-queue";
import { useUploads } from "./uploads-provider";

type Outcome = "done" | "error" | "cancelled";

export interface TrackedUploads {
  /** Starts following these queue IDs, replacing any earlier ones. */
  track: (ids: readonly string[]) => void;
  total: number;
  done: number;
  failed: number;
  cancelled: number;
  /** Still queued, uploading or paused. */
  pending: number;
  /** Something was tracked and nothing is pending any more. */
  settled: boolean;
}

/**
 * Follows a set of uploads started from a page. The last outcome of each is remembered, so the
 * count survives the person clearing finished items from the panel; a retried upload leaves its
 * outcome until it ends again.
 */
export function useTrackedUploads(): TrackedUploads {
  const { items } = useUploads();
  const [ids, setIds] = useState<readonly string[]>([]);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(new Map());

  const track = useCallback((next: readonly string[]) => {
    setIds(next);
    setOutcomes(new Map());
  }, []);

  useEffect(() => {
    setOutcomes((previous) => {
      const next = new Map(previous);
      for (const id of ids) {
        const item = items.find((i) => i.id === id);
        if (!item) {
          continue;
        }
        if (isActive(item.status)) {
          next.delete(id);
        } else {
          next.set(
            id,
            item.status === "done" ? "done" : item.status === "error" ? "error" : "cancelled",
          );
        }
      }
      const same =
        next.size === previous.size &&
        [...next].every(([id, outcome]) => previous.get(id) === outcome);
      return same ? previous : next;
    });
  }, [items, ids]);

  return useMemo(() => {
    const values = [...outcomes.values()];
    const count = (outcome: Outcome) => values.filter((v) => v === outcome).length;
    const pending = ids.length - values.length;
    return {
      track,
      total: ids.length,
      done: count("done"),
      failed: count("error"),
      cancelled: count("cancelled"),
      pending,
      settled: ids.length > 0 && pending === 0,
    };
  }, [ids, outcomes, track]);
}
