import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import request from "supertest";
import { expect } from "vitest";
import {
  createdInviteResponse,
  fileNode,
  folderListing,
  meResponse,
  type FileNode,
  type FolderListing,
} from "@cloud/shared";
import { createApp } from "../app.js";
import type { Config } from "../config.js";
import { openDatabase } from "../db/client.js";
import { users } from "../db/schema/index.js";
import type { MediaTools } from "../photos/tools.js";
import { TEST_SECRET_KEY } from "./secret-key.js";

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "correct horse battery";

export function harness(opts: { media?: Partial<MediaTools> } = {}) {
  const db = openDatabase(":memory:");
  const clock = { t: Date.now() };
  const dataDir = mkdtempSync(join(tmpdir(), "cloud-files-"));
  const config: Config = {
    production: false,
    port: 0,
    dataDir,
    publicOrigin: ORIGIN,
    secretKey: TEST_SECRET_KEY,
  };
  const app = createApp({
    config,
    version: "0.0.0",
    db,
    now: () => clock.t,
    ...(opts.media && { media: opts.media }),
  });

  async function signUp(email: string, admin = false) {
    if (admin) {
      const res = await request(app)
        .post("/api/auth/setup")
        .set("Origin", ORIGIN)
        .send({ email, password: PASSWORD });
      expect(res.status).toBe(201);
      return session(res, email);
    }
    const adminCookie = h.adminCookie;
    const created = await request(app)
      .post("/api/admin/invites")
      .set("Origin", ORIGIN)
      .set("Cookie", adminCookie)
      .send({ role: "member" });
    const { token } = createdInviteResponse.parse(created.body);
    const res = await request(app)
      .post("/api/auth/register")
      .set("Origin", ORIGIN)
      .send({ token, email, password: PASSWORD });
    expect(res.status).toBe(201);
    return session(res, email);
  }

  function session(res: request.Response, email: string) {
    const header = (res.get("Set-Cookie") ?? []).find((c) => c.startsWith("sid="));
    const cookie = header?.split(";")[0] ?? "";
    const user = meResponse.parse(res.body).user;
    return { cookie, user, email, ...client(cookie) };
  }

  function client(cookie: string) {
    const withCookie = (r: request.Test) => r.set("Cookie", cookie);
    return {
      get: (path: string) => withCookie(request(app).get(path)),
      post: (path: string, body?: object) => {
        const r = withCookie(request(app).post(path).set("Origin", ORIGIN));
        return body ? r.send(body) : r;
      },
      patch: (path: string, body: object) =>
        withCookie(request(app).patch(path).set("Origin", ORIGIN)).send(body),
      del: (path: string) => withCookie(request(app).delete(path).set("Origin", ORIGIN)),

      /** tus creation request (no body); returns the raw response. */
      tusCreate: (meta: Record<string, string>, length: number) => {
        const encoded = Object.entries(meta)
          .map(([k, v]) => `${k} ${Buffer.from(v).toString("base64")}`)
          .join(",");
        return withCookie(
          request(app)
            .post("/api/uploads")
            .set("Origin", ORIGIN)
            .set("Tus-Resumable", "1.0.0")
            .set("Upload-Length", String(length))
            .set("Upload-Metadata", encoded),
        );
      },
      tusPatch: (location: string, offset: number, bytes: Buffer) =>
        withCookie(
          request(app)
            .patch(location)
            .set("Origin", ORIGIN)
            .set("Tus-Resumable", "1.0.0")
            .set("Content-Type", "application/offset+octet-stream")
            .set("Upload-Offset", String(offset)),
        ).send(bytes),
      tusHead: (location: string) =>
        withCookie(request(app).head(location).set("Tus-Resumable", "1.0.0")),
      tusDelete: (location: string) =>
        withCookie(
          request(app).delete(location).set("Origin", ORIGIN).set("Tus-Resumable", "1.0.0"),
        ),

      /** Upload `bytes` in one PATCH; returns the finished file's ID. */
      async upload(parentId: string, name: string, bytes: Buffer, replaceId?: string) {
        const created = await this.tusCreate(
          { filename: name, parentId, ...(replaceId && { replaceId }) },
          bytes.length,
        );
        expect(created.status).toBe(201);
        // An empty upload is complete at creation and answers with the file ID straight away.
        const early = created.get("Cloud-File-Id");
        if (early) return early;
        const location = created.get("Location") ?? "";
        const done = await this.tusPatch(location, 0, bytes);
        expect(done.status).toBe(204);
        return done.get("Cloud-File-Id") ?? "";
      },
      async root(): Promise<FolderListing> {
        const res = await this.get("/api/files/root");
        expect(res.status).toBe(200);
        return folderListing.parse(res.body);
      },
      async folder(id: string): Promise<FolderListing> {
        const res = await this.get(`/api/folders/${id}`);
        expect(res.status).toBe(200);
        return folderListing.parse(res.body);
      },
      async mkdir(parentId: string, name: string): Promise<FileNode> {
        const res = await this.post("/api/folders", { parentId, name });
        expect(res.status).toBe(201);
        return fileNode.parse(res.body);
      },
    };
  }

  const h = {
    app,
    db,
    clock,
    config,
    dataDir,
    adminCookie: "",
    async admin(email = "admin@example.com") {
      const s = await signUp(email, true);
      h.adminCookie = s.cookie;
      return s;
    },
    member: (email: string) => signUp(email),
    setQuota(userId: string, quotaBytes: number) {
      db.update(users).set({ quotaBytes }).where(eq(users.id, userId)).run();
    },
  };
  return h;
}
export type Harness = ReturnType<typeof harness>;

/** Collect a response body as a Buffer whatever its content type. */
export function binary(r: request.Test): request.Test {
  return r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => {
      cb(null, Buffer.concat(chunks));
    });
  });
}

/** Where a version's bytes must be on disk: names never appear in the path. */
export function blobFile(dataDir: string, ownerId: string, versionId: string): string {
  return join(dataDir, "files", ownerId, versionId.slice(0, 2), versionId);
}
