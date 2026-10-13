import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createdAppPasswordResponse, createdInviteResponse, meResponse } from "@cloud/shared";
import { createApp } from "../../../api/src/app.js";
import type { Config } from "../../../api/src/config.js";
import { openDatabase } from "../../../api/src/db/client.js";
import { TEST_SECRET_KEY } from "../../../api/src/testing/secret-key.js";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery";

export interface LiveApi {
  base: string;
  dataDir: string;
  /** Invite and register a member; returns an app password. Every test gets its own account. */
  member: (email: string) => Promise<{ id: string; token: string }>;
  close: () => Promise<void>;
}

/** The real API (real SQLite, real blob storage in a temp dir) listening on a free port. */
export async function startApi(): Promise<LiveApi> {
  const dataDir = mkdtempSync(join(tmpdir(), "cloud-desktop-api-"));
  const config: Config = {
    production: false,
    port: 0,
    dataDir,
    publicOrigin: ORIGIN,
    secretKey: TEST_SECRET_KEY,
  };
  const db = openDatabase(join(dataDir, "db", "cloud.sqlite"));
  const app = createApp({ config, version: "0.0.0", db });
  const server: Server = createServer((req, res) => {
    app(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  const setup = await fetch(`${base}/api/auth/setup`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: PASSWORD }),
  });
  if (setup.status !== 201) throw new Error(`setup failed: ${String(setup.status)}`);
  const adminCookie =
    (setup.headers.getSetCookie().find((c) => c.startsWith("sid=")) ?? "").split(";")[0] ?? "";

  async function member(email: string): Promise<{ id: string; token: string }> {
    const invite = await fetch(`${base}/api/admin/invites`, {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    const { token: inviteToken } = createdInviteResponse.parse(await invite.json());
    const registered = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ token: inviteToken, email, password: PASSWORD }),
    });
    if (registered.status !== 201) throw new Error(`register failed: ${String(registered.status)}`);
    const cookie =
      (registered.headers.getSetCookie().find((c) => c.startsWith("sid=")) ?? "").split(";")[0] ??
      "";
    const { user } = meResponse.parse(await registered.json());
    const made = await fetch(`${base}/api/auth/app-passwords`, {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "desktop tests", password: PASSWORD }),
    });
    return { id: user.id, token: createdAppPasswordResponse.parse(await made.json()).token };
  }

  return {
    base,
    dataDir,
    member,
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
