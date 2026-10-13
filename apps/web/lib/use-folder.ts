"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode, FolderListing } from "@cloud/shared";
import { errorCodeOf } from "./api";
import { getFolder, getRoot } from "./files-api";

export type FolderState =
  | { status: "loading" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; listing: FolderListing };

/**
 * A folder's listing. `folderId` null is the person's root. `reload` fetches again and keeps
 * showing the old listing meanwhile, so the table does not flash after every change.
 */
export function useFolder(folderId: string | null): {
  state: FolderState;
  reload: () => Promise<void>;
} {
  const [state, setState] = useState<FolderState>({ status: "loading" });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    latest.current += 1;
    const mine = latest.current;
    try {
      const listing = await (folderId === null ? getRoot() : getFolder(folderId));
      if (mine === latest.current) {
        setState({ status: "ready", listing });
      }
    } catch (e) {
      if (mine === latest.current) {
        setState({ status: "error", code: errorCodeOf(e) });
      }
    }
  }, [folderId]);

  useEffect(() => {
    void reload();
    return () => {
      latest.current += 1;
    };
  }, [reload]);

  return { state, reload };
}
