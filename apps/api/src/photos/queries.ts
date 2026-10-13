import { sql, type SQL } from "drizzle-orm";
import type { Album, PhotoItem } from "@cloud/shared";
import { HttpError } from "../http/errors.js";
import type { Tx } from "../files/tree.js";
import { mediaKind } from "./kinds.js";

/*
 * The one place that decides what a "photo" is: a file of the user whose current version is an
 * image or a video and that is active (neither it nor an ancestor is trashed). Trashing marks
 * only the top item, so instead of walking each photo's ancestors the queries compute the set of
 * inactive folders once per call (`dead`: trashed folders and everything below them) and exclude it.
 */

const IS_MEDIA = sql`(v.mime like 'image/%' or v.mime like 'video/%')`;

function dead(ownerId: string): SQL {
  return sql`dead(id) as (
    select id from files where owner_id = ${ownerId} and kind = 'folder' and deleted_at is not null
    union
    select f.id from files f join dead d on f.parent_id = d.id
  )`;
}

interface PhotoRow {
  id: string;
  name: string;
  mime: string;
  taken: number;
  exif: number;
  width: number | null;
  height: number | null;
}

function toPhotoItem(row: PhotoRow): PhotoItem {
  return {
    fileId: row.id,
    name: row.name,
    mime: row.mime,
    kind: mediaKind(row.mime) === "video" ? "video" : "image",
    takenAt: new Date(row.taken).toISOString(),
    takenAtSource: row.exif ? "exif" : "upload",
    width: row.width,
    height: row.height,
  };
}

export interface PhotoCursor {
  takenAt: number;
  fileId: string;
}

export function encodeCursor(cursor: PhotoCursor): string {
  return Buffer.from(JSON.stringify([cursor.takenAt, cursor.fileId])).toString("base64url");
}

export function decodeCursor(value: string): PhotoCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "number" &&
      Number.isSafeInteger(parsed[0]) &&
      typeof parsed[1] === "string" &&
      parsed[1].length > 0 &&
      parsed[1].length <= 64
    ) {
      return { takenAt: parsed[0], fileId: parsed[1] };
    }
  } catch {
    // fall through to the same rejection
  }
  throw new HttpError(400, "invalid_request");
}

/** The caller's active photos, optionally only those of one album (ownership checked by the caller). */
function selectPhotos(
  tx: Tx,
  opts: {
    ownerId: string;
    albumId?: string;
    after?: PhotoCursor;
    limit?: number;
    newestFirst: boolean;
  },
): PhotoRow[] {
  const taken = sql`coalesce(m.taken_at, v.created_at)`;
  const join = opts.albumId
    ? sql`join album_items ai on ai.file_id = f.id and ai.album_id = ${opts.albumId}`
    : sql``;
  const after = opts.after
    ? sql`and (${taken} < ${opts.after.takenAt} or (${taken} = ${opts.after.takenAt} and f.id < ${opts.after.fileId}))`
    : sql``;
  const order = opts.newestFirst ? sql`${taken} desc, f.id desc` : sql`${taken} asc, f.id asc`;
  const limit = opts.limit === undefined ? sql`` : sql`limit ${opts.limit}`;
  return tx.all<PhotoRow>(sql`
    with recursive ${dead(opts.ownerId)}
    select f.id as id, f.name as name, v.mime as mime, ${taken} as taken,
           m.taken_at is not null as exif, m.width as width, m.height as height
      from files f
      ${join}
      join file_versions v on v.id = f.current_version_id
      left join media_info m on m.version_id = v.id
     where f.owner_id = ${opts.ownerId} and f.kind = 'file' and f.deleted_at is null
       and ${IS_MEDIA}
       and f.id not in (select id from dead)
       ${after}
     order by ${order}
     ${limit}`);
}

/** Newest first; `limit` items plus the cursor of the next page when more remain. */
export function photoPage(
  tx: Tx,
  ownerId: string,
  opts: { cursor?: string; limit: number },
): { items: PhotoItem[]; nextCursor: string | null } {
  const after = opts.cursor === undefined ? undefined : decodeCursor(opts.cursor);
  const rows = selectPhotos(tx, {
    ownerId,
    ...(after && { after }),
    limit: opts.limit + 1,
    newestFirst: true,
  });
  const page = rows.slice(0, opts.limit);
  const last = page.at(-1);
  return {
    items: page.map(toPhotoItem),
    nextCursor:
      rows.length > opts.limit && last
        ? encodeCursor({ takenAt: last.taken, fileId: last.id })
        : null,
  };
}

/** Oldest first, all of them: an album's pictures read like a story. */
export function albumPhotos(tx: Tx, ownerId: string, albumId: string): PhotoItem[] {
  return selectPhotos(tx, { ownerId, albumId, newestFirst: false }).map(toPhotoItem);
}

/** The subset of `fileIds` that are the caller's active photos. */
export function activePhotoIds(tx: Tx, ownerId: string, fileIds: string[]): Set<string> {
  if (fileIds.length === 0) return new Set();
  const ids = sql.join(
    fileIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = tx.all<{ id: string }>(sql`
    with recursive ${dead(ownerId)}
    select f.id as id
      from files f
      join file_versions v on v.id = f.current_version_id
     where f.owner_id = ${ownerId} and f.kind = 'file' and f.deleted_at is null
       and ${IS_MEDIA}
       and f.id in (${ids})
       and f.id not in (select id from dead)`);
  return new Set(rows.map((r) => r.id));
}

interface AlbumRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  n: number;
  cover: string | null;
}

/** The caller's albums (or one), newest updated first, counting and covering active items only. */
export function albumsOf(tx: Tx, ownerId: string, albumId?: string): Album[] {
  const onlyThis = albumId === undefined ? sql`` : sql`and a.id = ${albumId}`;
  const onlyThisItems = albumId === undefined ? sql`` : sql`and ai.album_id = ${albumId}`;
  const rows = tx.all<AlbumRow>(sql`
    with recursive ${dead(ownerId)},
    active(album_id, file_id, added_at, seq) as (
      select ai.album_id, ai.file_id, ai.added_at, ai.rowid
        from album_items ai
        join albums a on a.id = ai.album_id and a.owner_id = ${ownerId}
        join files f on f.id = ai.file_id and f.owner_id = ${ownerId}
                    and f.kind = 'file' and f.deleted_at is null
        join file_versions v on v.id = f.current_version_id
       where ${IS_MEDIA}
         and f.id not in (select id from dead)
         ${onlyThisItems}
    )
    select a.id as id, a.name as name, a.created_at as created_at, a.updated_at as updated_at,
           (select count(*) from active x where x.album_id = a.id) as n,
           (select x.file_id from active x where x.album_id = a.id
             order by x.added_at desc, x.seq desc limit 1) as cover
      from albums a
     where a.owner_id = ${ownerId} ${onlyThis}
     order by a.updated_at desc, a.rowid desc`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    itemCount: r.n,
    coverFileId: r.cover,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}
