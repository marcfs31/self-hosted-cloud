"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode, PhotoItem } from "@cloud/shared";
import { errorCodeOf } from "./api";
import { appendPage } from "./photos";
import { getPhotoPage } from "./photos-api";

export type TimelineState =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | {
      status: "ready";
      items: readonly PhotoItem[];
      hasMore: boolean;
      loadingMore: boolean;
      /** The last "load more" failed; the person can try again, nothing retries by itself. */
      moreError: ErrorCode | null;
    };

/**
 * The timeline, a page at a time. `loadMore` is safe to call from an observer: it does nothing
 * while a request is in flight or when the end is reached.
 */
export function usePhotoTimeline(): {
  state: TimelineState;
  reload: () => Promise<void>;
  loadMore: () => void;
} {
  const [state, setState] = useState<TimelineState>({ status: "loading" });
  const cursor = useRef<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    busy.current = true;
    cursor.current = null;
    setState({ status: "loading" });
    try {
      const page = await getPhotoPage(null);
      if (mine === generation.current) {
        cursor.current = page.nextCursor;
        setState({
          status: "ready",
          items: page.items,
          hasMore: page.nextCursor !== null,
          loadingMore: false,
          moreError: null,
        });
      }
    } catch (e) {
      if (mine === generation.current) {
        setState({ status: "error", code: errorCodeOf(e) });
      }
    } finally {
      if (mine === generation.current) {
        busy.current = false;
      }
    }
  }, []);

  const loadMore = useCallback(() => {
    if (busy.current || cursor.current === null) {
      return;
    }
    const mine = generation.current;
    busy.current = true;
    setState((s) => (s.status === "ready" ? { ...s, loadingMore: true, moreError: null } : s));
    getPhotoPage(cursor.current).then(
      (page) => {
        if (mine !== generation.current) {
          return;
        }
        busy.current = false;
        cursor.current = page.nextCursor;
        setState((s) =>
          s.status === "ready"
            ? {
                status: "ready",
                items: appendPage(s.items, page.items),
                hasMore: page.nextCursor !== null,
                loadingMore: false,
                moreError: null,
              }
            : s,
        );
      },
      (e: unknown) => {
        if (mine !== generation.current) {
          return;
        }
        busy.current = false;
        setState((s) =>
          s.status === "ready" ? { ...s, loadingMore: false, moreError: errorCodeOf(e) } : s,
        );
      },
    );
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  return { state, reload, loadMore };
}
