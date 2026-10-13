import type { SearchResponse } from "@cloud/shared";
import { apiFetch } from "./api";

/** How many results the search page asks for; the API allows up to 100. */
export const SEARCH_LIMIT = 50;

export function searchFiles(
  q: string,
  signal?: AbortSignal,
  limit: number = SEARCH_LIMIT,
): Promise<SearchResponse> {
  const query = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch<SearchResponse>(`/search?${query.toString()}`, signal ? { signal } : {});
}

/** The search page for `q`; without a query, the empty search page. */
export function searchHref(q: string): string {
  const text = q.trim();
  return text === "" ? "/search" : `/search?q=${encodeURIComponent(text)}`;
}
