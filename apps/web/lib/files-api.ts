import type {
  CreateFolderRequest,
  FileNode,
  FolderListing,
  TrashListing,
  UpdateFileRequest,
  UsageResponse,
  VersionListing,
} from "@cloud/shared";
import { apiFetch, apiFetchResponse } from "./api";
import { readTextPreview, TEXT_PREVIEW_BYTES, type TextPreview } from "./preview";

/** Typed calls to the files endpoints. Every failure is an ApiError from apiFetch. */

function id(value: string): string {
  return encodeURIComponent(value);
}

export function getRoot(signal?: AbortSignal): Promise<FolderListing> {
  return apiFetch<FolderListing>("/files/root", signal ? { signal } : {});
}

export function getFolder(folderId: string, signal?: AbortSignal): Promise<FolderListing> {
  return apiFetch<FolderListing>(`/folders/${id(folderId)}`, signal ? { signal } : {});
}

export function createFolder(request: CreateFolderRequest): Promise<FileNode> {
  return apiFetch<FileNode>("/folders", { method: "POST", json: request });
}

export function updateFile(fileId: string, request: UpdateFileRequest): Promise<FileNode> {
  return apiFetch<FileNode>(`/files/${id(fileId)}`, { method: "PATCH", json: request });
}

export function trashFile(fileId: string): Promise<void> {
  return apiFetch(`/files/${id(fileId)}`, { method: "DELETE" });
}

export function getUsage(): Promise<UsageResponse> {
  return apiFetch<UsageResponse>("/usage");
}

export function getVersions(fileId: string): Promise<VersionListing> {
  return apiFetch<VersionListing>(`/files/${id(fileId)}/versions`);
}

export function restoreVersion(fileId: string, versionId: string): Promise<FileNode> {
  return apiFetch<FileNode>(`/files/${id(fileId)}/versions/${id(versionId)}/restore`, {
    method: "POST",
  });
}

export function deleteVersion(fileId: string, versionId: string): Promise<void> {
  return apiFetch(`/files/${id(fileId)}/versions/${id(versionId)}`, { method: "DELETE" });
}

export function getTrash(): Promise<TrashListing> {
  return apiFetch<TrashListing>("/trash");
}

export function restoreFromTrash(fileId: string): Promise<FileNode> {
  return apiFetch<FileNode>(`/trash/${id(fileId)}/restore`, { method: "POST" });
}

export function deleteForever(fileId: string): Promise<void> {
  return apiFetch(`/trash/${id(fileId)}`, { method: "DELETE" });
}

export function emptyTrash(): Promise<void> {
  return apiFetch("/trash", { method: "DELETE" });
}

/** Links for the browser to follow: the server sends these as attachments. */
export function downloadHref(fileId: string): string {
  return `/api/files/${id(fileId)}/content?download=1`;
}

export function versionDownloadHref(fileId: string, versionId: string): string {
  return `/api/files/${id(fileId)}/versions/${id(versionId)}/content?download=1`;
}

/** The bytes as the browser may show them: the server sends inline only for safe types. */
export function contentHref(fileId: string): string {
  return `/api/files/${id(fileId)}/content`;
}

/**
 * The first TEXT_PREVIEW_BYTES of a file as text. `size` is the file's size: a server that
 * honours the Range header sends just that many bytes, so the body alone cannot show that
 * the file goes on.
 */
export async function getTextPreview(
  fileId: string,
  size: number,
  signal?: AbortSignal,
): Promise<TextPreview> {
  const response = await apiFetchResponse(`/files/${id(fileId)}/content`, {
    headers: { range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` },
    ...(signal ? { signal } : {}),
  });
  const preview = await readTextPreview(response);
  return { text: preview.text, truncated: preview.truncated || size > TEXT_PREVIEW_BYTES };
}
