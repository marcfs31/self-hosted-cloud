import { HttpError } from "../http/errors.js";

export interface RateLimiter {
  /** Throws 429 too_many_attempts when the key already has `max` recent failures. */
  check(key: string): void;
  /**
   * `check` plus an immediate, synchronous count of this attempt. Call it BEFORE any await
   * (Argon2 verify): requests that arrive while an earlier one is still being verified see it.
   * Then `clear` (or `release`) on success; a failure needs no further call.
   */
  begin(key: string): void;
  fail(key: string): void;
  /** Takes back one `begin` that turned out fine, without forgetting other attempts. */
  release(key: string): void;
  clear(key: string): void;
}

export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

/** Shared by every guessable secret: 5 failures per key in 15 minutes. */
export const FAILURE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 } as const;

/**
 * Sign-in guesses against one account from any number of addresses (an IPv6 /64, a botnet).
 * Higher than FAILURE_LIMIT so that one stranger cannot easily lock the owner out.
 */
export const ACCOUNT_LOGIN_LIMIT = { max: 25, windowMs: 15 * 60 * 1000 } as const;

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

  function check(key: string): void {
    if (recent(key).length >= max) throw new HttpError(429, "too_many_attempts");
  }

  function fail(key: string): void {
    if (failures.size >= 10_000) sweep();
    failures.set(key, [...recent(key), now()]);
  }

  return {
    check,
    begin(key) {
      check(key);
      fail(key);
    },
    fail,
    release(key) {
      const live = recent(key);
      live.pop();
      if (live.length === 0) failures.delete(key);
      else failures.set(key, live);
    },
    clear(key) {
      failures.delete(key);
    },
  };
}
