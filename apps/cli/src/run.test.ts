import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { normalizeServer } from "./commands/login.js";
import { run } from "./run.js";

async function cli(argv: string[]) {
  let out = "";
  let err = "";
  const dir = mkdtempSync(join(tmpdir(), "cloud-run-"));
  const code = await run(argv, {
    stdout: { write: (c) => ((out += c), true) },
    stderr: { write: (c) => ((err += c), true) },
    stdin: Readable.from([]),
    env: { CLOUD_CONFIG_DIR: dir },
    cwd: dir,
    homeDir: dir,
  });
  return { code, out, err };
}

describe("run", () => {
  it("prints the version from package.json", async () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const res = await cli(["--version"]);
    expect(res).toEqual({ code: 0, out: `${manifest.version}\n`, err: "" });
  });

  it("--help lists every command and the exit codes", async () => {
    const res = await cli(["--help"]);
    expect(res.code).toBe(0);
    for (const name of [
      "login",
      "logout",
      "whoami",
      "ls",
      "upload",
      "download",
      "mkdir",
      "mv",
      "rm",
      "search",
      "share",
    ]) {
      expect(res.out).toMatch(new RegExp(`^ {2}${name} `, "m"));
    }
    expect(res.out).toContain("Exit codes");
  });

  it("every command has --help that works without a login", async () => {
    for (const name of [
      "login",
      "logout",
      "whoami",
      "ls",
      "upload",
      "download",
      "mkdir",
      "mv",
      "rm",
      "search",
      "share",
    ]) {
      const res = await cli([name, "--help"]);
      expect(res.code).toBe(0);
      expect(res.out).toContain(`Usage: cloud ${name}`);
      expect(res.out).toContain("--json");
    }
  });

  it("no command is a usage error that shows the help on stderr", async () => {
    const res = await cli([]);
    expect(res.code).toBe(1);
    expect(res.err).toContain("Usage: cloud <command>");
  });

  it("an unknown command is a usage error", async () => {
    const res = await cli(["frobnicate"]);
    expect(res.code).toBe(1);
    expect(res.err).toContain("Unknown command: frobnicate");
  });

  it("an unknown option is a usage error that points at the command help", async () => {
    const res = await cli(["ls", "--wat"]);
    expect(res.code).toBe(1);
    expect(res.err).toContain("--wat");
    expect(res.err).toContain("cloud ls --help");
    expect(res.out).toBe("");
  });

  it.each([
    [["ls", "a", "b"]],
    [["upload"]],
    [["download"]],
    [["mkdir"]],
    [["mkdir", "/"]],
    [["mv", "/a"]],
    [["mv", "/", "/a"]],
    [["rm"]],
    [["search"]],
    [["search", "x", "--limit", "500"]],
    [["share"]],
    [["login", "extra"]],
    [["whoami", "extra"]],
  ])("%j is a usage error before any network access", async (argv) => {
    const res = await cli(argv);
    expect(res.code).toBe(1);
    expect(res.err).toContain("--help");
  });

  it("remote paths with .. are usage errors", async () => {
    // not logged in would be exit 2, so this proves the path is checked first
    expect((await cli(["ls", "/a/../b"])).code).toBe(1);
  });
});

describe("normalizeServer", () => {
  it("accepts bare hosts and strips paths and trailing slashes", () => {
    expect(normalizeServer("cloud.example.com")).toBe("https://cloud.example.com");
    expect(normalizeServer("https://cloud.example.com/")).toBe("https://cloud.example.com");
    expect(normalizeServer("http://localhost:3000/app")).toBe("http://localhost:3000");
  });

  it("refuses other schemes", () => {
    expect(() => normalizeServer("ftp://x")).toThrow(/https/);
  });
});
