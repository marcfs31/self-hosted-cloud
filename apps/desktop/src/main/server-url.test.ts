import { describe, expect, it } from "vitest";
import { allowedExternalUrl, isLocalHost, normalizeServer } from "./server-url.js";

describe("normalizeServer", () => {
  it.each([
    ["https://cloud.example.com", "https://cloud.example.com"],
    ["https://cloud.example.com/", "https://cloud.example.com"],
    ["  https://Cloud.Example.com  ", "https://cloud.example.com"],
    ["cloud.example.com", "https://cloud.example.com"],
    ["https://cloud.example.com:8443", "https://cloud.example.com:8443"],
    ["http://localhost:4951", "http://localhost:4951"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"],
    ["http://[::1]:3000", "http://[::1]:3000"],
    ["http://pi.localhost", "http://pi.localhost"],
  ])("accepts %s", (input, origin) => {
    expect(normalizeServer(input)).toEqual({ ok: true, origin });
  });

  it.each([
    ["", "server_required"],
    ["   ", "server_required"],
    ["http://cloud.example.com", "server_insecure"],
    ["http://192.168.1.20:3000", "server_insecure"],
    ["http://localhost.evil.com", "server_insecure"],
    ["ftp://cloud.example.com", "server_invalid"],
    ["file:///etc/passwd", "server_invalid"],
    ["javascript://cloud.example.com", "server_invalid"],
    ["https://user:secret@cloud.example.com", "server_invalid"],
    ["https://cloud.example.com/app", "server_invalid"],
    ["https://cloud.example.com/?a=1", "server_invalid"],
    ["https://cloud.example.com/#x", "server_invalid"],
    ["https://", "server_invalid"],
    ["https://exa mple.com", "server_invalid"],
  ])("rejects %j with %s", (input, code) => {
    expect(normalizeServer(input)).toEqual({ ok: false, code });
  });
});

describe("isLocalHost", () => {
  it("accepts only loopback names", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("LOCALHOST")).toBe(true);
    expect(isLocalHost("a.localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("[::1]")).toBe(true);
    expect(isLocalHost("localhost.example.com")).toBe(false);
    expect(isLocalHost("notlocalhost")).toBe(false);
    expect(isLocalHost("10.0.0.1")).toBe(false);
  });
});

describe("allowedExternalUrl (the openExternal guard)", () => {
  const server = "https://cloud.example.com";

  it("allows the server's own origin", () => {
    expect(allowedExternalUrl("https://cloud.example.com/", server)?.href).toBe(
      "https://cloud.example.com/",
    );
    expect(allowedExternalUrl("https://CLOUD.example.com/files?x=1", server)?.pathname).toBe(
      "/files",
    );
    expect(allowedExternalUrl("http://localhost:4951/", "http://localhost:4951")?.origin).toBe(
      "http://localhost:4951",
    );
  });

  it("refuses everything else", () => {
    const refused = [
      "https://evil.example.org/",
      "https://cloud.example.com.evil.org/",
      "https://cloud.example.com@evil.org/",
      "https://user:pw@cloud.example.com/",
      "http://cloud.example.com/",
      "https://cloud.example.com:8443/",
      "file:///Applications",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "smb://cloud.example.com/share",
      "not a url",
      "",
    ];
    for (const url of refused) expect(allowedExternalUrl(url, server), url).toBeUndefined();
  });

  it("refuses everything when no valid server is configured", () => {
    expect(allowedExternalUrl("https://cloud.example.com/", undefined)).toBeUndefined();
    expect(
      allowedExternalUrl("https://cloud.example.com/", "http://cloud.example.com"),
    ).toBeUndefined();
    expect(allowedExternalUrl("https://cloud.example.com/", "")).toBeUndefined();
  });

  it("refuses plain http on a non-local host even if the server was stored that way", () => {
    expect(allowedExternalUrl("http://pi.lan/", "http://pi.lan")).toBeUndefined();
  });
});
