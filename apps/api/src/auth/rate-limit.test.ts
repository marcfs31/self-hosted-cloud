import { describe, expect, it } from "vitest";
import { HttpError } from "../http/errors.js";
import { createRateLimiter } from "./rate-limit.js";

describe("rate limiter", () => {
  it("blocks after max failures and recovers once the window has passed", () => {
    let t = 1_000;
    const limiter = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
    for (let i = 0; i < 3; i++) {
      limiter.check("k");
      limiter.fail("k");
    }
    expect(() => {
      limiter.check("k");
    }).toThrow(HttpError);
    limiter.check("other");
    t += 1001;
    limiter.check("k");
  });

  it("clear forgets earlier failures", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => 5 });
    limiter.fail("k");
    limiter.clear("k");
    limiter.check("k");
  });

  it("begin counts the attempt at once, so a burst cannot pass a not-yet-failed check", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 1000, now: () => 5 });
    for (let i = 0; i < 3; i++) limiter.begin("k");
    expect(() => {
      limiter.begin("k");
    }).toThrow(HttpError);
    limiter.clear("k");
    limiter.begin("k");
  });

  it("release takes back one begin and keeps the others", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => 5 });
    limiter.begin("k");
    limiter.begin("k");
    limiter.release("k");
    limiter.begin("k");
    expect(() => {
      limiter.check("k");
    }).toThrow(HttpError);
  });
});
