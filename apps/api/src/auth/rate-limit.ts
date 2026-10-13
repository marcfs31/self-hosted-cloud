import { HttpError } from "../http/errors.js";

export interface RateLimiter {
  /** Throws 429 too_many_attempts when the key already has `max` recent failures. */
  check(key: string): void;
  fail(key: string): void;
  clear(key: string): void;
}

export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

/** Shared by every guessable secret: 5 failures per key in 15 minutes. */
export const FAILURE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 } as const;

export function createRateLimiter({
  max,
  windowMs,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  const failures = new Map<string, number[]>();

  function recent(key: string): number[] {
    const cutoff = now() - windowMs;
    const live = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (live.length === 0) failures.delete(key);
    else failures.set(key, live);
    return live;
  }

  function sweep(): void {
    for (const key of failures.keys()) recent(key);
  }

  return {
    check(key) {
      if (recent(key).length >= max) throw new HttpError(429, "too_many_attempts");
    },
    fail(key) {
      if (failures.size >= 10_000) sweep();
      failures.set(key, [...recent(key), now()]);
    },
    clear(key) {
      failures.delete(key);
    },
  };
}
