"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The latest `value`, but changing at most once every `ms`. Used for text a screen reader
 * announces, so a busy upload does not read out a new line every moment.
 */
export function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const lastChange = useRef(0);

  useEffect(() => {
    const wait = Math.max(0, lastChange.current + ms - Date.now());
    const timer = setTimeout(() => {
      lastChange.current = Date.now();
      setShown(value);
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);

  return shown;
}
