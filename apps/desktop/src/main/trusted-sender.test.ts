import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isTrustedSender } from "./trusted-sender.js";

const settings = pathToFileURL(
  "/Applications/Cloud.app/Contents/Resources/app/assets/settings.html",
).href;

describe("isTrustedSender", () => {
  it("accepts the settings page", () => {
    expect(isTrustedSender(settings, settings)).toBe(true);
    expect(isTrustedSender(`${settings}#top`, settings)).toBe(true);
  });

  it("refuses everything else", () => {
    expect(isTrustedSender(undefined, settings)).toBe(false);
    expect(isTrustedSender("", settings)).toBe(false);
    expect(isTrustedSender("https://cloud.example.com/", settings)).toBe(false);
    expect(isTrustedSender("about:blank", settings)).toBe(false);
    expect(isTrustedSender("file:///tmp/evil.html", settings)).toBe(false);
    expect(isTrustedSender("not a url", settings)).toBe(false);
    expect(isTrustedSender(settings.replace("settings.html", "other.html"), settings)).toBe(false);
  });
});
