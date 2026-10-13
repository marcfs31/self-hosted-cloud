import { z } from "zod";
import { breadcrumb, fileNode } from "./files.js";

/*
 * Search contract (session required, results scoped to the session user, active items only):
 *
 *   GET /search?q=<text>&limit=<1..100, default 50>  → SearchResponse
 *     Case-insensitive substring match on names (SQLite FTS5 trigram for q ≥ 3 characters,
 *     LIKE for shorter queries). Ordered: exact name match first, then prefix, then by
 *     updatedAt descending.
 *
 * Previews are a web feature built on GET /files/:id/content; there is no preview endpoint.
 */

export const searchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SearchQuery = z.input<typeof searchQuery>;

export const searchResult = z.object({
  node: fileNode,
  /** Ancestors of the node, root first, excluding the node itself. */
  path: z.array(breadcrumb),
});
export type SearchResult = z.infer<typeof searchResult>;

export const searchResponse = z.object({ results: z.array(searchResult) });
export type SearchResponse = z.infer<typeof searchResponse>;
