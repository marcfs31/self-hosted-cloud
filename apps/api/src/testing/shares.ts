import { expect } from "vitest";
import request from "supertest";
import { createdShareResponse, type CreateShareRequest } from "@cloud/shared";
import { ORIGIN, type Harness } from "./harness.js";

type Session = Awaited<ReturnType<Harness["admin"]>>;

export interface Link {
  id: string;
  token: string;
  /** Path prefix of every public endpoint of this share. */
  base: string;
}

export async function createLink(owner: Session, body: CreateShareRequest): Promise<Link> {
  const res = await owner.post("/api/shares", body);
  expect(res.status).toBe(201);
  const { share, token } = createdShareResponse.parse(res.body);
  return { id: share.id, token, base: `/api/public/shares/${token}` };
}

/** Requests as an anonymous visitor: no session, optionally a share grant cookie. */
export function visitor(h: Harness, link: Link, cookie?: string) {
  const withCookie = (r: request.Test) => (cookie ? r.set("Cookie", cookie) : r);
  return {
    get: (path = "") => withCookie(request(h.app).get(`${link.base}${path}`)),
    head: (path = "") => withCookie(request(h.app).head(`${link.base}${path}`)),
    unlock: (password: string, origin: string | null = ORIGIN) => {
      const r = request(h.app).post(`${link.base}/unlock`);
      return withCookie(origin === null ? r : r.set("Origin", origin)).send({ password });
    },
    tusCreate: (meta: Record<string, string>, length: number, origin: string | null = ORIGIN) => {
      const encoded = Object.entries(meta)
        .map(([k, v]) => `${k} ${Buffer.from(v).toString("base64")}`)
        .join(",");
      const r = request(h.app)
        .post(`${link.base}/uploads`)
        .set("Tus-Resumable", "1.0.0")
        .set("Upload-Length", String(length))
        .set("Upload-Metadata", encoded);
      return withCookie(origin === null ? r : r.set("Origin", origin));
    },
    tusPatch: (location: string, offset: number, bytes: Buffer, origin: string | null = ORIGIN) => {
      const r = request(h.app)
        .patch(location)
        .set("Tus-Resumable", "1.0.0")
        .set("Content-Type", "application/offset+octet-stream")
        .set("Upload-Offset", String(offset));
      return withCookie(origin === null ? r : r.set("Origin", origin)).send(bytes);
    },
    tusHead: (location: string) =>
      withCookie(request(h.app).head(location).set("Tus-Resumable", "1.0.0")),
    tusDelete: (location: string, origin: string | null = ORIGIN) => {
      const r = request(h.app).delete(location).set("Tus-Resumable", "1.0.0");
      return withCookie(origin === null ? r : r.set("Origin", origin));
    },
  };
}

/** The grant cookie ("sg_<id>=<grant>") from an unlock response. */
export function grantCookie(res: request.Response): string {
  const header = (res.get("Set-Cookie") ?? []).find((c) => c.startsWith("sg_"));
  expect(header).toBeDefined();
  return header?.split(";")[0] ?? "";
}

export interface ZipListing {
  name: string;
  method: number;
  size: number;
  data: Buffer;
}

/** Read the central directory of a (non-zip64) archive; independent of the writer under test. */
export function readZip(zip: Buffer): ZipListing[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const entries: ZipListing[] = [];
  for (let n = 0; n < count; n++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.push({ name, method, size, data: zip.subarray(dataAt, dataAt + compressed) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
