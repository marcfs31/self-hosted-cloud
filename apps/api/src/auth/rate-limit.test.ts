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
});
