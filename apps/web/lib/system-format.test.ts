import { describe, expect, it } from "vitest";
import {
  formatCelsius,
  formatDuration,
  formatNumber,
  formatRelative,
  secondsSince,
  share,
} from "./system-format";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe("formatDuration", () => {
  it("keeps the two largest non-zero units", () => {
    expect(formatDuration(3 * 86400 + 4 * 3600 + 5 * 60 + 6, "en")).toBe("3 days, 4 hours");
    expect(formatDuration(2 * 3600 + 30 * 60, "en")).toBe("2 hours, 30 minutes");
  });

  it("drops a zero second unit instead of printing it", () => {
    expect(formatDuration(86400 + 5 * 60, "en")).toBe("1 day");
    expect(formatDuration(5 * 60, "en")).toBe("5 minutes");
  });

  it("counts seconds under a minute and survives bad input", () => {
    expect(formatDuration(42, "en")).toBe("42 seconds");
    expect(formatDuration(0, "en")).toBe("0 seconds");
    expect(formatDuration(-5, "en")).toBe("0 seconds");
    expect(formatDuration(Number.NaN, "en")).toBe("0 seconds");
  });

  it("uses the locale's unit names", () => {
    expect(formatDuration(86400 + 3600, "es")).toBe("1 día y 1 hora");
  });
});

describe("formatRelative", () => {
  it("reads recent times as now and picks the natural unit", () => {
    expect(formatRelative(ago(10), NOW, "en")).toBe("now");
    expect(formatRelative(ago(5 * 60), NOW, "en")).toBe("5 minutes ago");
    expect(formatRelative(ago(3 * 3600), NOW, "en")).toBe("3 hours ago");
    expect(formatRelative(ago(3 * 86400), NOW, "en")).toBe("3 days ago");
  });

  it("never reads as the future when the clocks disagree", () => {
    expect(formatRelative(ago(-120), NOW, "en")).toBe("now");
  });

  it("is localised", () => {
    expect(formatRelative(ago(3 * 3600), NOW, "it")).toBe("3 ore fa");
  });
});

describe("secondsSince", () => {
  it("counts whole seconds and clamps the future to zero", () => {
    expect(secondsSince(ago(90), NOW)).toBe(90);
    expect(secondsSince(ago(-90), NOW)).toBe(0);
  });
});

describe("share", () => {
  it("is the used fraction, clamped", () => {
    expect(share(25, 100)).toBe(0.25);
    expect(share(150, 100)).toBe(1);
    expect(share(-1, 100)).toBe(0);
  });

  it("is 0 for an empty or invalid total", () => {
    expect(share(5, 0)).toBe(0);
    expect(share(5, Number.NaN)).toBe(0);
  });
});

describe("numbers", () => {
  it("formats in the locale", () => {
    expect(formatNumber(0.456, "en", 2)).toBe("0.46");
    expect(formatNumber(0.456, "es", 2)).toBe("0,46");
    expect(formatCelsius(52.44, "en")).toBe("52.4°C");
  });
});
