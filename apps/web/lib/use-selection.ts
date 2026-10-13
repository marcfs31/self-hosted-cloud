"use client";

import { useCallback, useState } from "react";

export interface Selection {
  selected: ReadonlySet<string>;
  /** Stable, so memoised tiles are not re-rendered by it. */
  toggle: (id: string) => void;
  clear: () => void;
}

const NONE: ReadonlySet<string> = new Set();

/** A set of chosen ids. Every change makes a new set, so a view can tell it changed. */
export function useSelection(): Selection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(NONE);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(NONE);
  }, []);

  return { selected, toggle, clear };
}
