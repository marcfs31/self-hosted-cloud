import { describe, expect, it } from "vitest";
import { canRegisterServiceWorker, isIosSafari } from "./pwa";

const base = {
  production: true,
  protocol: "https:",
  hostname: "cloud.example.test",
  supported: true,
};

describe("canRegisterServiceWorker", () => {
  it("registers in production on https", () => {
    expect(canRegisterServiceWorker(base)).toBe(true);
  });

  it("registers in production on localhost without https", () => {
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(canRegisterServiceWorker({ ...base, protocol: "http:", hostname }), hostname).toBe(
        true,
      );
    }
  });

  it("never registers in development", () => {
    expect(canRegisterServiceWorker({ ...base, production: false })).toBe(false);
    expect(canRegisterServiceWorker({ ...base, production: false, hostname: "localhost" })).toBe(
      false,
    );
  });

  it("does not register on plain http to another host, or without browser support", () => {
    expect(canRegisterServiceWorker({ ...base, protocol: "http:" })).toBe(false);
    expect(canRegisterServiceWorker({ ...base, protocol: "http:", hostname: "192.168.1.20" })).toBe(
      false,
    );
    expect(canRegisterServiceWorker({ ...base, supported: false })).toBe(false);
  });
});

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("isIosSafari", () => {
  it("recognises Safari on iPhone and on iPad (which says Macintosh)", () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true);
    expect(isIosSafari(IPAD_SAFARI, 5)).toBe(true);
  });

  it("is not fooled by a Mac, other iOS browsers or Android", () => {
    expect(isIosSafari(IPAD_SAFARI, 0)).toBe(false);
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false);
    expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false);
  });
});
