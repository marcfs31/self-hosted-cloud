import type {
  CreatedShareResponse,
  CreateShareRequest,
  ListSharesResponse,
  PublicFolderListing,
  PublicShareInfo,
} from "@cloud/shared";
import { apiFetch } from "./api";

/**
 * Typed calls to the sharing endpoints. The owner's calls need a session; the public ones
 * (below) are addressed by the share token alone. Every failure is an ApiError from apiFetch.
 */

function id(value: string): string {
  return encodeURIComponent(value);
}

export function createShare(request: CreateShareRequest): Promise<CreatedShareResponse> {
  return apiFetch<CreatedShareResponse>("/shares", { method: "POST", json: request });
}

export function listShares(): Promise<ListSharesResponse> {
  return apiFetch<ListSharesResponse>("/shares");
}

export function revokeShare(shareId: string): Promise<void> {
  return apiFetch(`/shares/${id(shareId)}`, { method: "DELETE" });
}

function publicPath(token: string): string {
  return `/public/shares/${id(token)}`;
}

export function getPublicShare(token: string, signal?: AbortSignal): Promise<PublicShareInfo> {
  return apiFetch<PublicShareInfo>(publicPath(token), signal ? { signal } : {});
}

export function unlockShare(token: string, password: string): Promise<void> {
  return apiFetch(`${publicPath(token)}/unlock`, { method: "POST", json: { password } });
}

/** `folderId` null is the shared folder itself. */
export function getPublicFolder(
  token: string,
  folderId: string | null,
  signal?: AbortSignal,
): Promise<PublicFolderListing> {
  const query = folderId === null ? "" : `?folderId=${id(folderId)}`;
  return apiFetch<PublicFolderListing>(
    `${publicPath(token)}/folder${query}`,
    signal ? { signal } : {},
  );
}

/** The shared file's bytes, for the browser to show (`download` false) or to save. */
export function publicContentHref(token: string, download: boolean): string {
  return `/api${publicPath(token)}/content${download ? "?download=1" : ""}`;
}

/** A file inside a shared folder, as an attachment. */
export function publicFileHref(token: string, fileId: string): string {
  return `/api${publicPath(token)}/files/${id(fileId)}/content?download=1`;
}

export function publicZipHref(token: string, folderId: string | null): string {
  return `/api${publicPath(token)}/zip${folderId === null ? "" : `?folderId=${id(folderId)}`}`;
}

export function publicUploadEndpoint(token: string): string {
  return `/api${publicPath(token)}/uploads`;
}
