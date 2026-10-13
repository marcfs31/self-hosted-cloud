import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { createdAppPasswordResponse, createdInviteResponse, meResponse } from "@cloud/shared";
import { createApp } from "../../../api/src/app.js";
import type { Config } from "../../../api/src/config.js";
import { openDatabase } from "../../../api/src/db/client.js";
import type { InStream, Io } from "../io.js";
import { run } from "../run.js";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery";

export interface LiveApi {
  base: string;
  /** An app password of the admin. */
  token: string;
  dataDir: string;
  /** Number of tus PATCH requests the API has received so far. */
  patches: () => number;
  /** A request with the admin's session cookie (the web app's way in). */
  session: (path: string, init?: { method?: string; body?: unknown }) => Promise<Response>;
  /** Invite and register a member; returns their ID and an app password. */
  member: (email: string) => Promise<{ id: string; token: string }>;
  /** A request with the admin's app password. */
  bearer: (path: string) => Promise<Response>;
  close: () => Promise<void>;
}

/** The real API (real SQLite, real blob storage in a temp dir) listening on a free port. */
export async function startApi(): Promise<LiveApi> {
  const dataDir = mkdtempSync(join(tmpdir(), "cloud-cli-api-"));
  const config: Config = { production: false, port: 0, dataDir, publicOrigin: ORIGIN };
  const db = openDatabase(join(dataDir, "db", "cloud.sqlite"));
  const app = createApp({ config, version: "0.0.0", db });
  let patches = 0;
  const server: Server = createServer((req, res) => {
    if (req.method === "PATCH") patches++;
    app(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const setup = await fetch(`${base}/api/auth/setup`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: PASSWORD }),
  });
  if (setup.status !== 201) throw new Error(`setup failed: ${setup.status}`);
  const cookie =
    (setup.headers.getSetCookie().find((c) => c.startsWith("sid=")) ?? "").split(";")[0] ?? "";

  const session: LiveApi["session"] = (path, init = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: { Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });

  const created = await session("/api/auth/app-passwords", {
    method: "POST",
    body: { name: "cli tests" },
  });
  if (created.status !== 201) throw new Error(`app password failed: ${created.status}`);
  const { token } = createdAppPasswordResponse.parse(await created.json());

  async function member(email: string): Promise<{ id: string; token: string }> {
    const invite = await session("/api/admin/invites", {
      method: "POST",
      body: { role: "member" },
    });
    const { token: inviteToken } = createdInviteResponse.parse(await invite.json());
    const registered = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ token: inviteToken, email, password: PASSWORD }),
    });
    if (registered.status !== 201) throw new Error(`register failed: ${registered.status}`);
    const memberCookie =
      (registered.headers.getSetCookie().find((c) => c.startsWith("sid=")) ?? "").split(";")[0] ??
      "";
    const { user } = meResponse.parse(await registered.json());
    const made = await fetch(`${base}/api/auth/app-passwords`, {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: memberCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "cli tests" }),
    });
    return { id: user.id, token: createdAppPasswordResponse.parse(await made.json()).token };
  }

  return {
    base,
    token,
    member,
    dataDir,
    patches: () => patches,
    session,
    bearer: (path) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      db.$client.close();
    },
  };
}

export interface CliResult {
  code: number;
  out: string;
  err: string;
}

export interface CliOptions {
  env?: Record<string, string>;
  stdin?: string;
  /** Pretend stdin is a terminal and stream the text in as keystrokes. */
  tty?: boolean;
  stderrIsTty?: boolean;
  cwd?: string;
  chunkSize?: number;
}

/** Drives `run()` the way the real binary does, with every outside dependency injected. */
export function makeCli(home: { configDir: string; cwd: string }) {
  return async (argv: string[], options: CliOptions = {}): Promise<CliResult> => {
    let out = "";
    let err = "";
    const stdin: InStream =
      options.tty === true
        ? new PassThrough()
        : Readable.from(options.stdin === undefined ? [] : [options.stdin]);
    if (options.tty === true) {
      stdin.isTTY = true;
      stdin.push(options.stdin ?? "");
    }
    const io: Io = {
      stdout: { write: (chunk) => ((out += chunk), true) },
      stderr: {
        write: (chunk) => ((err += chunk), true),
        ...(options.stderrIsTty === true && { isTTY: true }),
      },
      stdin,
      env: { CLOUD_CONFIG_DIR: home.configDir, ...options.env },
      cwd: options.cwd ?? home.cwd,
      homeDir: home.cwd,
      ...(options.chunkSize !== undefined && { chunkSize: options.chunkSize }),
    };
    const code = await run(argv, io);
    return { code, out, err };
  };
}
