"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UsageResponse } from "@cloud/shared";
import { getUsage } from "../lib/files-api";

interface UsageContext {
  /** Null until the first answer arrives, or when it could not be read. */
  usage: UsageResponse | null;
  refresh: () => void;
}

const Context = createContext<UsageContext | null>(null);

export function UsageProvider({ children }: { children: ReactNode }) {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stale = false;
    getUsage().then(
      (next) => {
        if (!stale) {
          setUsage(next);
        }
      },
      () => {
        // Unknown is not zero: keep the last reading, or none, rather than invent one.
      },
    );
    return () => {
      stale = true;
    };
  }, [tick]);

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  const value = useMemo(() => ({ usage, refresh }), [usage, refresh]);
  return <Context value={value}>{children}</Context>;
}

export function useUsage(): UsageContext {
  const value = useContext(Context);
  if (!value) {
    throw new Error("useUsage must be used inside <UsageProvider>");
  }
  return value;
}
