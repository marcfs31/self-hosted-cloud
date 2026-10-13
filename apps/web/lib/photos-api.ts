import type { Album, AlbumDetail, AlbumList, PhotoPage } from "@cloud/shared";
import { apiFetch } from "./api";

/** Typed calls to the photos and albums endpoints. Every failure is an ApiError from apiFetch. */

/** How many photos one timeline request asks for, and how many a grid renders at a time. */
export const PAGE_SIZE = 100;

/** The most ids one add-to-album request may carry. */
const MAX_IDS_PER_REQUEST = 500;

function id(value: string): string {
  return encodeURIComponent(value);
}

export function getPhotoPage(cursor: string | null, signal?: AbortSignal): Promise<PhotoPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor !== null) {
    query.set("cursor", cursor);
  }
  return apiFetch<PhotoPage>(`/photos?${query.toString()}`, signal ? { signal } : {});
}

export async function getAlbums(): Promise<readonly Album[]> {
  return (await apiFetch<AlbumList>("/albums")).albums;
}

export function getAlbum(albumId: string): Promise<AlbumDetail> {
  return apiFetch<AlbumDetail>(`/albums/${id(albumId)}`);
}

export function createAlbum(name: string): Promise<Album> {
  return apiFetch<Album>("/albums", { method: "POST", json: { name } });
}

export function renameAlbum(albumId: string, name: string): Promise<Album> {
  return apiFetch<Album>(`/albums/${id(albumId)}`, { method: "PATCH", json: { name } });
}

export function deleteAlbum(albumId: string): Promise<void> {
  return apiFetch(`/albums/${id(albumId)}`, { method: "DELETE" });
}

/** Adds the photos in as many requests as the API allows; duplicates are ignored by the API. */
export async function addAlbumItems(albumId: string, fileIds: readonly string[]): Promise<void> {
  for (let start = 0; start < fileIds.length; start += MAX_IDS_PER_REQUEST) {
    await apiFetch(`/albums/${id(albumId)}/items`, {
      method: "POST",
      json: { fileIds: fileIds.slice(start, start + MAX_IDS_PER_REQUEST) },
    });
  }
}

export function removeAlbumItem(albumId: string, fileId: string): Promise<void> {
  return apiFetch(`/albums/${id(albumId)}/items/${id(fileId)}`, { method: "DELETE" });
}

/** Links for the browser: <img>, <video> and <a> follow these, never fetch. */
export function thumbnailHref(fileId: string, size: 256 | 1024): string {
  return `/api/files/${id(fileId)}/thumbnail?size=${size}`;
}

export function contentHref(fileId: string): string {
  return `/api/files/${id(fileId)}/content`;
}
