"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorCode, PublicShareInfo } from "@cloud/shared";
import { ApiError, errorCodeOf } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { getPublicShare } from "../../lib/shares-api";
import { DropBox } from "./drop-box";
import { FileShare } from "./file-share";
import { FolderShare } from "./folder-share";
import { NotFound } from "./not-found";
import { UnlockForm } from "./unlock-form";

type State =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error"; code: ErrorCode }
  | { status: "ready"; info: PublicShareInfo };

/** What a link opens: the password form, or the file, the folder or the drop box it shares. */
export function PublicShareView({ token }: { token: string }) {
  const all = useT();
  const t = all.shares.public;
  const [state, setState] = useState<State>({ status: "loading" });
  const wasLocked = useRef(false);

  const load = useCallback(async () => {
    try {
      setState({ status: "ready", info: await getPublicShare(token) });
    } catch (e) {
      setState(
        e instanceof ApiError && e.status === 404
          ? { status: "notFound" }
          : { status: "error", code: errorCodeOf(e) },
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const locked = state.status === "ready" && state.info.requiresPassword && !state.info.unlocked;

  // The password form is gone once it works: put the focus on the page, not on nothing.
  useEffect(() => {
    if (locked) {
      wasLocked.current = true;
    } else if (state.status === "ready" && wasLocked.current) {
      wasLocked.current = false;
      document.getElementById("main")?.focus();
    }
  }, [locked, state.status]);

  if (state.status === "loading") {
    return <p role="status">{t.loading}</p>;
  }
  if (state.status === "notFound") {
    return <NotFound />;
  }
  if (state.status === "error") {
    return (
      <div className="stack">
        <p role="alert" className="alert">
          {all.errors[state.code]}
        </p>
        <div>
          <button
            type="button"
            className="button"
            onClick={() => {
              setState({ status: "loading" });
              void load();
            }}
          >
            {all.common.app.retry}
          </button>
        </div>
      </div>
    );
  }

  const { info } = state;
  if (locked) {
    return <UnlockForm token={token} onUnlocked={load} />;
  }
  if (info.allowUpload) {
    return <DropBox token={token} info={info} />;
  }
  if (info.kind === "file") {
    return <FileShare token={token} info={info} />;
  }
  return <FolderShare token={token} info={info} onLocked={load} />;
}
