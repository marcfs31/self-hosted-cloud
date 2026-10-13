import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  expiryDays,
  isExpired,
  isExpiryChoice,
  passwordProblem,
  previewKind,
  shareLink,
} from "./shares";

describe("expiry", () => {
  it("offers 1, 7, 30 and 365 days or never, with a week as the default", () => {
    expect(EXPIRY_CHOICES).toEqual(["1", "7", "30", "365", "never"]);
    expect(DEFAULT_EXPIRY).toBe("7");
  });

  it("turns a choice into the API's days, and never into null", () => {
    expect(expiryDays("1")).toBe(1);
    expect(expiryDays("365")).toBe(365);
    expect(expiryDays("never")).toBeNull();
  });

  it("only accepts the offered choices", () => {
    expect(isExpiryChoice("30")).toBe(true);
    expect(isExpiryChoice("2")).toBe(false);
    expect(isExpiryChoice("")).toBe(false);
  });

  it("reads a past expiry as expired and 'never' as not", () => {
    const now = Date.parse("2026-10-13T12:00:00.000Z");
    expect(isExpired("2026-10-13T11:59:59.000Z", now)).toBe(true);
    expect(isExpired("2026-10-13T12:00:00.000Z", now)).toBe(true);
    expect(isExpired("2026-10-14T00:00:00.000Z", now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });
});

describe("share link", () => {
  it("joins the origin and the token under /s/", () => {
    expect(shareLink("https://cloud.example.test", "abc-DEF_123")).toBe(
      "https://cloud.example.test/s/abc-DEF_123",
    );
  });

  it("never lets a token break out of the path", () => {
    expect(shareLink("http://localhost:3000", "a/b?c")).toBe("http://localhost:3000/s/a%2Fb%3Fc");
  });
});

describe("password rule", () => {
  it("accepts no password and a long enough one", () => {
    expect(passwordProblem("")).toBeNull();
    expect(passwordProblem("12345678")).toBeNull();
  });

  it("refuses a short one, so a typo can't silently weaken the link", () => {
    expect(passwordProblem("1234567")).toBe("tooShort");
    expect(passwordProblem(" ")).toBe("tooShort");
  });
});

describe("preview", () => {
  it("previews the media the API serves inline", () => {
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("video/mp4")).toBe("video");
    expect(previewKind("audio/ogg")).toBe("audio");
  });

  it("does not preview what the API serves as a download", () => {
    expect(previewKind("image/svg+xml")).toBeNull();
    expect(previewKind("application/pdf")).toBeNull();
    expect(previewKind("text/plain")).toBeNull();
    expect(previewKind(null)).toBeNull();
  });
});
