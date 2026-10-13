import {
  createFolderRequest,
  fileNode,
  folderListing,
  type FileNode,
  type FolderListing,
} from "@cloud/shared";
import type { ApiClient } from "./client.js";
import { conflictError, notFoundError, usageError } from "./errors.js";
import { formatPath } from "./format.js";

/**
 * Remote paths are '/'-separated names from the root. Empty segments and '.' are ignored,
 * '..' is refused (there is no working directory to climb out of), names are NFC like the server's.
 */
export function parseRemotePath(input: string): string[] {
  const segments: string[] = [];
  for (const raw of input.split("/")) {
    const name = raw.normalize("NFC");
    if (name === "" || name === ".") continue;
    if (name === "..") throw usageError(`'..' is not supported in remote paths: ${input}`);
    segments.push(name);
  }
  return segments;
}

export function listFolder(client: ApiClient, id: string): Promise<FolderListing> {
  return client.json("GET", `/api/folders/${encodeURIComponent(id)}`, folderListing);
}

export function listRoot(client: ApiClient): Promise<FolderListing> {
  return client.json("GET", "/api/files/root", folderListing);
}

/** Walk folder listings from the root to the named item. */
export async function resolveNode(
  client: ApiClient,
  segments: readonly string[],
): Promise<FileNode> {
  let listing = await listRoot(client);
  let node = listing.folder;
  for (const [i, name] of segments.entries()) {
    const next = listing.children.find((child) => child.name === name);
    if (!next) throw notFoundError(`No such file or folder: ${formatPath(segments)}`);
    node = next;
    if (i < segments.length - 1) {
      if (next.kind !== "folder") {
        throw notFoundError(`No such file or folder: ${formatPath(segments)}`);
      }
      listing = await listFolder(client, next.id);
    }
  }
  return node;
}

export async function resolveFolder(
  client: ApiClient,
  segments: readonly string[],
): Promise<FileNode> {
  const node = await resolveNode(client, segments);
  if (node.kind !== "folder") throw usageError(`${formatPath(segments)} is not a folder.`);
  return node;
}

export function createFolder(client: ApiClient, parentId: string, name: string): Promise<FileNode> {
  const body = createFolderRequest.parse({ parentId, name });
  return client.json("POST", "/api/folders", fileNode, body);
}

/** The existing child folder called `name`, or a new one. A file of that name is a conflict. */
export async function childFolder(
  client: ApiClient,
  parent: FolderListing,
  name: string,
): Promise<{ node: FileNode; created: boolean }> {
  const existing = parent.children.find((child) => child.name === name);
  if (existing) {
    if (existing.kind !== "folder") {
      throw conflictError(`${name} already exists and is a file, not a folder.`);
    }
    return { node: existing, created: false };
  }
  return { node: await createFolder(client, parent.folder.id, name), created: true };
}
