import type { ExistsRequest, ExistsResponse } from "@cloud/shared";
import { ApiError, apiFetch } from "./api";
import { createFolder, getRoot } from "./files-api";

/**
 * Phone photo backup: hash what the person picked, ask the server which hashes it already has,
 * upload the rest. The uploads themselves go through the uploads provider; this module holds the
 * decisions and the two API calls, so they can be tested without a browser.
 */

/** Not translated: the folder is found again by this name, in whichever language the app is. */
export const CAMERA_FOLDER = "Camera uploads";
/** Digests need the whole file in memory, so larger files are uploaded without the check. */
export const MAX_HASH_BYTES = 512 * 1024 * 1024;
/** Hashes per /files/exists request (the server accepts up to 1000). */
export const EXISTS_BATCH = 500;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size) {
    batches.push(items.slice(at, at + size));
  }
  return batches;
}

export function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SubtleCrypto exists only in a secure context (https or localhost). */
export function canHash(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

export async function sha256Of(file: Blob): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
}

export type Hashed =
  | { file: File; kind: "hashed"; sha256: string }
  /** Over MAX_HASH_BYTES: uploaded without a duplicate check. */
  | { file: File; kind: "unchecked" }
  /** The browser could not read it (for example a photo that lives only in the phone's cloud). */
  | { file: File; kind: "unreadable" };

export async function hashFile(file: File): Promise<Hashed> {
  if (file.size > MAX_HASH_BYTES) {
    return { file, kind: "unchecked" };
  }
  try {
    return { file, kind: "hashed", sha256: await sha256Of(file) };
  } catch {
    return { file, kind: "unreadable" };
  }
}

export interface BackupPlan {
  toUpload: File[];
  /** Already in the cloud, or the same content as an earlier file of this selection. */
  alreadyBackedUp: number;
  /** Uploaded without a duplicate check because they are too large. */
  unchecked: number;
  unreadable: number;
}

/** Decides what to upload, given which of the hashes the server already has. */
export function planBackup(entries: readonly Hashed[], existing: ReadonlySet<string>): BackupPlan {
  const plan: BackupPlan = { toUpload: [], alreadyBackedUp: 0, unchecked: 0, unreadable: 0 };
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "unreadable") {
      plan.unreadable += 1;
    } else if (entry.kind === "unchecked") {
      plan.unchecked += 1;
      plan.toUpload.push(entry.file);
    } else if (existing.has(entry.sha256) || seen.has(entry.sha256)) {
      plan.alreadyBackedUp += 1;
    } else {
      seen.add(entry.sha256);
      plan.toUpload.push(entry.file);
    }
  }
  return plan;
}

/** Which of the hashes the person's active files already have. */
export async function findExisting(sha256s: readonly string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const batch of chunk([...new Set(sha256s)], EXISTS_BATCH)) {
    const request: ExistsRequest = { sha256s: batch };
    const response = await apiFetch<ExistsResponse>("/files/exists", {
      method: "POST",
      json: request,
    });
    for (const hash of response.existing) {
      existing.add(hash);
    }
  }
  return existing;
}

/** The "Camera uploads" folder at the root, created when missing. */
export async function ensureCameraFolder(): Promise<string> {
  const find = async () => {
    const root = await getRoot();
    const found = root.children.find(
      (child) => child.kind === "folder" && child.name === CAMERA_FOLDER,
    );
    return { rootId: root.folder.id, folderId: found?.id };
  };
  const first = await find();
  if (first.folderId) {
    return first.folderId;
  }
  try {
    return (await createFolder({ parentId: first.rootId, name: CAMERA_FOLDER })).id;
  } catch (e) {
    // Another tab or device made it a moment ago.
    if (e instanceof ApiError && e.code === "name_conflict") {
      const again = await find();
      if (again.folderId) {
        return again.folderId;
      }
    }
    throw e;
  }
}
