import type {
  CreateFolderRequest,
  FileNode,
  FolderListing,
  TrashListing,
  UpdateFileRequest,
  UsageResponse,
  VersionListing,
} from "@cloud/shared";
import { apiFetch } from "./api";

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
