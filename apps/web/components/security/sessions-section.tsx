"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { ConfirmDialog } from "../confirm-dialog";

/** "Sign out of other devices": ends every other session, keeps this one. */
export function SessionsSection() {
  const all = useT();
  const t = all.security.sessions;
  const [dialog, setDialog] = useState<{ returnFocus: HTMLElement | null } | null>(null);
  const [notice, setNotice] = useState("");

  return (
    <section aria-labelledby="sessions-heading" className="stack">
      <h2 id="sessions-heading">{t.title}</h2>
      <p>{t.intro}</p>
      <p role="status" className="note">
        {notice}
      </p>
      <div>
        <button
          type="button"
          className="button"
          onClick={(event) => {
            setNotice("");
            setDialog({ returnFocus: event.currentTarget });
          }}
        >
          {t.button}
        </button>
      </div>
      {dialog ? (
        <ConfirmDialog
          title={t.confirmTitle}
          body={t.confirmBody}
          cancelLabel={all.security.cancel}
          submitLabel={t.confirmSubmit}
          submittingLabel={t.confirming}
          onConfirm={async () => {
            await apiFetch("/auth/sessions/revoke-others", { method: "POST" });
            setDialog(null);
            setNotice(t.done);
          }}
          onClose={() => {
            setDialog(null);
          }}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
    </section>
  );
}
