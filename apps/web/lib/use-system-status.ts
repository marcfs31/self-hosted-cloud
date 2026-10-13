"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode, SystemStatus } from "@cloud/shared";
import { errorCodeOf } from "./api";
import { getSystemStatus } from "./system-api";

export const REFRESH_MS = 30_000;

export type RefreshResult = "ok" | "failed" | "skipped";

export interface SystemStatusState {
  /** The last good reading; kept (and shown as outdated) when a later request fails. */
  data: SystemStatus | null;
  /** When `data` arrived, in this browser's clock (ms). */
  updatedAt: number | null;
  /** The failure of the latest request, cleared by the next success. */
  error: ErrorCode | null;
  /** Resolves "skipped" when a request is already running or the page has gone away. */
  refresh: () => Promise<RefreshResult>;
}

/**
 * Loads the system status, then again every 30 s while the tab is visible, and as soon as a
 * tab that was hidden for longer than that becomes visible. One request at a time.
 */
export function useSystemStatus(): SystemStatusState {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const abort = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const lastAttempt = useRef(0);

  const refresh = useCallback(async (): Promise<RefreshResult> => {
    const controller = abort.current;
    if (!controller || inFlight.current) {
      return "skipped";
    }
    const { signal } = controller;
    inFlight.current = true;
    try {
      const next = await getSystemStatus(signal);
      if (signal.aborted) {
        return "skipped";
      }
      setData(next);
      setUpdatedAt(Date.now());
      setError(null);
      return "ok";
    } catch (e) {
      if (signal.aborted) {
        return "skipped";
      }
      setError(errorCodeOf(e));
      return "failed";
    } finally {
      if (!signal.aborted) {
        inFlight.current = false;
        lastAttempt.current = Date.now();
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    inFlight.current = false;
    void refresh();

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, REFRESH_MS);
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastAttempt.current >= REFRESH_MS
      ) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { data, updatedAt, error, refresh };
}
