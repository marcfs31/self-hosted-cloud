"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode } from "@cloud/shared";
import { errorCodeOf } from "./api";

export type Resource<T> =
  { status: "loading" } | { status: "error"; code: ErrorCode } | { status: "ready"; data: T };

/**
 * Loads something once on mount and again on `reload()`. `fetcher` must be a stable
 * reference (a module-level function). A reload keeps showing the previous data.
 */
export function useResource<T>(fetcher: () => Promise<T>): {
  state: Resource<T>;
  reload: () => Promise<void>;
} {
  const [state, setState] = useState<Resource<T>>({ status: "loading" });
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const data = await fetcher();
      if (alive.current) {
        setState({ status: "ready", data });
      }
    } catch (e) {
      if (alive.current) {
        setState({ status: "error", code: errorCodeOf(e) });
      }
    }
  }, [fetcher]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { state, reload };
}
