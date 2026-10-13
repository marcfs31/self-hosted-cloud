import { and, eq, inArray } from "drizzle-orm";
import { davProperties } from "../db/schema/index.js";
import type { Tx } from "../files/tree.js";
import { DAV_NS, type PropertyChange } from "./requests.js";

/** What one resource may hold; a PROPPATCH past them gets 507 for the property that does not fit. */
export const MAX_PROPERTIES_PER_RESOURCE = 100;
export const MAX_PROPERTY_BYTES = 16 * 1024;
export const MAX_PROPERTY_TOTAL_BYTES = 128 * 1024;

const ID_CHUNK = 500;

export interface DeadProperty {
  ns: string;
  name: string;
  /** The property element, self-contained. */
  xml: string;
}

/** The dead properties of each of the given files, in name order. */
export function deadPropertiesOf(tx: Tx, fileIds: readonly string[]): Map<string, DeadProperty[]> {
  const byFile = new Map<string, DeadProperty[]>();
  for (let i = 0; i < fileIds.length; i += ID_CHUNK) {
    const rows = tx
      .select()
      .from(davProperties)
      .where(inArray(davProperties.fileId, fileIds.slice(i, i + ID_CHUNK)))
      .all();
    for (const row of rows) {
      const list = byFile.get(row.fileId) ?? [];
      list.push({ ns: row.ns, name: row.name, xml: row.xml });
      byFile.set(row.fileId, list);
    }
  }
  for (const list of byFile.values()) {
    list.sort((a, b) => (a.ns === b.ns ? compare(a.name, b.name) : compare(a.ns, b.ns)));
  }
  return byFile;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The status each change gets: 200 when applied, 403 for a protected property, 507 when it does
 * not fit, 424 for a change that was fine but did not happen because another one failed. The
 * changes are all applied or none is (RFC 4918 section 9.2), in document order. Every property in
 * the DAV: namespace is protected: those are the live ones, and a dead one could never be
 * told apart from them.
 */
export function applyPropertyChanges(
  tx: Tx,
  fileId: string,
  changes: readonly PropertyChange[],
): number[] {
  const held = new Map<string, number>();
  const key = (ns: string, name: string) => `${ns}\u0000${name}`;
  for (const row of tx.select().from(davProperties).where(eq(davProperties.fileId, fileId)).all()) {
    held.set(key(row.ns, row.name), Buffer.byteLength(row.xml));
  }
  let total = [...held.values()].reduce((sum, bytes) => sum + bytes, 0);

  const statuses = changes.map((change) => {
    if (change.ns === DAV_NS) return 403;
    const id = key(change.ns, change.name);
    const before = held.get(id) ?? 0;
    if (change.op === "remove") {
      held.delete(id);
      total -= before;
      return 200;
    }
    const bytes = Buffer.byteLength(change.xml);
    const count = held.size + (held.has(id) ? 0 : 1);
    if (
      bytes > MAX_PROPERTY_BYTES ||
      count > MAX_PROPERTIES_PER_RESOURCE ||
      total - before + bytes > MAX_PROPERTY_TOTAL_BYTES
    ) {
      return 507;
    }
    held.set(id, bytes);
    total += bytes - before;
    return 200;
  });
  if (statuses.some((status) => status !== 200)) {
    return statuses.map((status) => (status === 200 ? 424 : status));
  }

  for (const change of changes) {
    if (change.op === "remove") {
      tx.delete(davProperties)
        .where(
          and(
            eq(davProperties.fileId, fileId),
            eq(davProperties.ns, change.ns),
            eq(davProperties.name, change.name),
          ),
        )
        .run();
    } else {
      tx.insert(davProperties)
        .values({ fileId, ns: change.ns, name: change.name, xml: change.xml })
        .onConflictDoUpdate({
          target: [davProperties.fileId, davProperties.ns, davProperties.name],
          set: { xml: change.xml },
        })
        .run();
    }
  }
  return statuses;
}

/** COPY: the new resource starts with the source's dead properties. */
export function copyDeadProperties(tx: Tx, fromId: string, toId: string): void {
  const rows = tx.select().from(davProperties).where(eq(davProperties.fileId, fromId)).all();
  if (rows.length === 0) return;
  tx.insert(davProperties)
    .values(rows.map((row) => ({ ...row, fileId: toId })))
    .run();
}
