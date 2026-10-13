import { inArray, sql } from "drizzle-orm";
import type { SearchResult } from "@cloud/shared";
import { files } from "../db/schema/index.js";
import { chainOf, nodeSelect, toFileNode, type Tx } from "../files/tree.js";

/** The trigram tokenizer cannot match fewer than three characters; those use LIKE instead. */
const TRIGRAM_MIN = 3;

/** FTS5 phrase: the whole query as one quoted string, so no FTS syntax in user text is live. */
function ftsPhrase(q: string): string {
  return `"${q.replaceAll('"', '""')}"`;
}

function likeEscape(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Ids of the owner's active items whose name contains `q`, best first: exact name, then prefix,
 * then most recently updated. Everything user-supplied is bound, never interpolated.
 *
 * "Active" means no trashed ancestor-or-self. Trashing marks only the top item, so the inactive
 * set is the subtree of every trashed item, computed once (it is empty, and nearly free, when the
 * owner has nothing in the trash) instead of walking each candidate's ancestors.
 *
 * Case-folding: q of three or more characters goes through the trigram index, which folds Unicode
 * case but not diacritics. Shorter q, and the exact/prefix ranking, use SQLite LIKE, which folds
 * ASCII case only.
 */
export function searchIds(tx: Tx, ownerId: string, q: string, limit: number): string[] {
  const like = likeEscape(q);
  const matches =
    Array.from(q).length >= TRIGRAM_MIN
      ? sql`f.rowid in (select rowid from files_fts where files_fts match ${ftsPhrase(q)})`
      : sql`f.name like ${`%${like}%`} escape '\\'`;
  const rows = tx.all<{ id: string }>(sql`
    with recursive dead(id) as (
      select id from files indexed by files_deleted_at_idx
       where owner_id = ${ownerId} and deleted_at is not null
      union
      select c.id from files c join dead d on c.parent_id = d.id
    )
    select f.id from files f
     where f.owner_id = ${ownerId}
       and f.parent_id is not null
       and ${matches}
       and f.id not in (select id from dead)
     order by case
                when f.name like ${like} escape '\\' then 0
                when f.name like ${`${like}%`} escape '\\' then 1
                else 2
              end,
              f.updated_at desc,
              f.id
     limit ${limit}`);
  return rows.map((r) => r.id);
}

export function search(tx: Tx, ownerId: string, q: string, limit: number): SearchResult[] {
  const ids = searchIds(tx, ownerId, q, limit);
  if (ids.length === 0) return [];
  const nodes = new Map(
    nodeSelect(tx)
      .where(inArray(files.id, ids))
      .all()
      .map((row) => [row.file.id, toFileNode(row)]),
  );
  return ids.flatMap((id) => {
    const node = nodes.get(id);
    if (!node) return [];
    const ancestors = chainOf(tx, id).slice(1).reverse();
    return [{ node, path: ancestors.map(({ id: aid, name }) => ({ id: aid, name })) }];
  });
}
