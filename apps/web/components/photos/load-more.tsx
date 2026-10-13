"use client";

import { useEffect, useRef } from "react";
import { useT } from "../../lib/i18n/provider";

interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  /** False after a failure: the person retries with the button, nothing loops. */
  auto: boolean;
  /** Changes whenever the list grows, so an end still in view loads the next page too. */
  count: number;
  onLoadMore: () => void;
}

/**
 * Loads the next page when the end of the list scrolls near. The button is always there as
 * well: keyboard users reach it, and people who prefer reduced motion get no automatic loading.
 */
export function LoadMore({ hasMore, loading, auto, count, onLoadMore }: LoadMoreProps) {
  const t = useT().photos;
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = end.current;
    if (
      !hasMore ||
      loading ||
      !auto ||
      !element ||
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
    // `count` re-arms the observer after each page, which fires once for an end that is still visible.
  }, [hasMore, loading, auto, count, onLoadMore]);

  if (!hasMore) {
    return null;
  }
  return (
    <div ref={end} className="load-more">
      <button
        type="button"
        className="button button-quiet"
        disabled={loading}
        aria-busy={loading}
        onClick={onLoadMore}
      >
        {loading ? t.loadingMore : t.loadMore}
      </button>
    </div>
  );
}
