/** Runs at most `concurrency` tasks at a time; the rest wait in arrival order. */
export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createLimiter(concurrency: number): Limiter {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("limiter: concurrency must be a positive integer");
  }
  let active = 0;
  const waiting: (() => void)[] = [];

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active < concurrency) {
        active += 1;
      } else {
        // The finishing task hands its slot over, so `active` never dips below the real count.
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      try {
        return await task();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active -= 1;
      }
    },
  };
}
