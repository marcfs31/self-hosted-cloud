/** A drop-box reservation that has not seen a PATCH for this long stops counting. */
export const DROP_BOX_IDLE_MS = 15 * 60 * 1000;

export interface InFlightEntry {
  ownerId: string;
  /** Bytes announced (tus) or reserved so far (WebDAV) for the owner's quota. */
  size: number;
  /** Set for drop-box uploads, which are accounted separately from the owner's own. */
  shareId?: string;
  /** Creation, or the last PATCH: a drop-box reservation is idle (and ignored) after DROP_BOX_IDLE_MS. */
  touchedAt: number;
}

/**
 * Every byte that has been promised to an owner's disk but is not yet committed: tus uploads
 * and WebDAV PUT/COPY transfers. Quota usage is derived from committed files only, so without
 * this ledger N parallel transfers could each pass the check and write N times the quota.
 */
export interface InFlightLedger {
  /** tus uploads, by upload ID. Owned by the upload service. */
  readonly uploads: Map<string, InFlightEntry>;
  /** WebDAV transfers, by a random ID. Callers add the entry before reading a byte and delete it in `finally`. */
  readonly transfers: Map<string, InFlightEntry>;
  /** The owner's own announced bytes; a drop box never counts here, so it cannot block the owner. */
  ownBytes(ownerId: string): number;
  /** Announced bytes of live (not idle) drop-box uploads of an owner, optionally of one share. */
  dropBoxBytes(ownerId: string, shareId?: string): number;
}

export function createInFlightLedger(now: () => number): InFlightLedger {
  const uploads = new Map<string, InFlightEntry>();
  const transfers = new Map<string, InFlightEntry>();
  return {
    uploads,
    transfers,
    ownBytes(ownerId) {
      let total = 0;
      for (const e of [...uploads.values(), ...transfers.values()]) {
        if (e.ownerId === ownerId && !e.shareId) total += e.size;
      }
      return total;
    },
    dropBoxBytes(ownerId, shareId) {
      let total = 0;
      for (const e of uploads.values()) {
        if (e.ownerId !== ownerId || !e.shareId) continue;
        if (shareId !== undefined && e.shareId !== shareId) continue;
        if (now() - e.touchedAt > DROP_BOX_IDLE_MS) continue;
        total += e.size;
      }
      return total;
    },
  };
}
