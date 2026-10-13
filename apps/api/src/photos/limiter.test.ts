import { describe, expect, it } from "vitest";
import { createLimiter } from "./limiter.js";

function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("createLimiter", () => {
  it("never runs more than the limit at once and starts the rest in arrival order", async () => {
    const limiter = createLimiter(2);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const gates = Array.from({ length: 7 }, deferred);
    const results = gates.map((gate, i) =>
      limiter.run(async () => {
        started.push(i);
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
        return i;
      }),
    );

    await tick();
    expect(started).toEqual([0, 1]);
    for (let i = 0; i < gates.length; i += 1) {
      gates[i]?.release();
      await tick();
      expect(running).toBeLessThanOrEqual(2);
    }
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(2);
  });

  it("frees the slot when a task throws and passes the error on", async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await limiter.run(() => Promise.resolve("next"))).toBe("next");
  });

  it("does not let a newcomer jump the queue while a slot is being handed over", async () => {
    const limiter = createLimiter(1);
    const first = deferred();
    const order: string[] = [];
    const a = limiter.run(async () => {
      await first.promise;
      order.push("a");
    });
    const b = limiter.run(() => {
      order.push("b");
      return Promise.resolve();
    });
    first.release();
    const c = limiter.run(() => {
      order.push("c");
      return Promise.resolve();
    });
    await Promise.all([a, b, c]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("rejects a non-positive limit", () => {
    expect(() => createLimiter(0)).toThrow();
  });
});
