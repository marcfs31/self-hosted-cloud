"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  AppPassword,
  AppPasswordList,
  CreateAppPasswordRequest,
  CreatedAppPasswordResponse,
} from "@cloud/shared";
import { apiFetch } from "../../lib/api";
import { useFormat, useT } from "../../lib/i18n/provider";
import { useClipboard } from "../../lib/use-clipboard";
import { useResource } from "../../lib/use-resource";
import { ConfirmDialog } from "../confirm-dialog";
import { Field } from "../form";
import { SecurityNameDialog } from "./name-dialog";

async function loadAppPasswords(): Promise<AppPassword[]> {
  const { appPasswords } = await apiFetch<AppPasswordList>("/auth/app-passwords");
  return appPasswords;
}

function CreatedToken({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const t = useT().security.appPasswords;
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { status, copy } = useClipboard(t.copied, t.copyFailed);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={`${id}-heading`} className="callout stack">
      <h3 id={`${id}-heading`} ref={headingRef} tabIndex={-1}>
        {t.createdTitle}
      </h3>
      <p>{t.createdNote}</p>
      <Field
        id={`${id}-token`}
        label={t.tokenLabel}
        className="secret"
        readOnly
        spellCheck={false}
        inputRef={inputRef}
        value={token}
      />
      <p className="note">{t.usageNote}</p>
      <div className="row-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            void copy(token).then((copied) => {
              if (!copied) {
                inputRef.current?.select();
              }
            });
          }}
        >
          {t.copy}
        </button>
        <button type="button" className="button button-quiet" onClick={onDismiss}>
          {t.dismiss}
        </button>
      </div>
      <p role="status" className="note">
        {status}
      </p>
    </section>
  );
}

type DialogState =
  | { kind: "create"; returnFocus: HTMLElement | null }
  | { kind: "revoke"; appPassword: AppPassword; returnFocus: HTMLElement | null };

export function AppPasswordsSection() {
  const all = useT();
  const t = all.security.appPasswords;
  const format = useFormat();
  const { state, reload } = useResource(loadAppPasswords);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  return (
    <section aria-labelledby="app-passwords-heading" className="stack">
      <h2 id="app-passwords-heading">{t.title}</h2>
      <p>{t.intro}</p>

      {state.status === "loading" ? <p role="status">{t.loading}</p> : null}
      {state.status === "error" ? (
        <div className="stack">
          <p role="alert" className="alert">
            {all.errors[state.code]}
          </p>
          <div>
            <button
              type="button"
              className="button"
              onClick={() => {
                void reload();
              }}
            >
              {all.common.app.retry}
            </button>
          </div>
        </div>
      ) : null}
      {state.status === "ready" ? (
        state.data.length === 0 ? (
          <p>{t.empty}</p>
        ) : (
          <table className="table">
            <caption className="sr-only">{t.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{t.colName}</th>
                <th scope="col">{t.colCreated}</th>
                <th scope="col">{t.colLastUsed}</th>
                <th scope="col">
                  <span className="sr-only">{t.colActions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((appPassword) => (
                <tr key={appPassword.id}>
                  <td data-label={t.colName} className="cell-wrap">
                    {appPassword.name}
                  </td>
                  <td data-label={t.colCreated}>{format.date(appPassword.createdAt)}</td>
                  <td data-label={t.colLastUsed}>
                    {appPassword.lastUsedAt === null
                      ? t.neverUsed
                      : format.dateTime(appPassword.lastUsedAt)}
                  </td>
                  <td data-label={t.colActions}>
                    <button
                      type="button"
                      className="button button-quiet button-small button-danger-text"
                      aria-label={t.revokeLabel(appPassword.name)}
                      onClick={(event) => {
                        setDialog({
                          kind: "revoke",
                          appPassword,
                          returnFocus: event.currentTarget,
                        });
                      }}
                    >
                      {t.revoke}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      <p role="status" className="note">
        {notice}
      </p>
      {token ? (
        <CreatedToken
          token={token}
          onDismiss={() => {
            setToken(null);
          }}
        />
      ) : null}
      <div>
        <button
          type="button"
          className="button"
          onClick={(event) => {
            setNotice("");
            setDialog({ kind: "create", returnFocus: event.currentTarget });
          }}
        >
          {t.create}
        </button>
      </div>

      {dialog?.kind === "create" ? (
        <SecurityNameDialog
          title={t.createTitle}
          label={t.nameLabel}
          hint={t.nameHint}
          requiredMessage={t.nameRequired}
          submitLabel={t.createSubmit}
          submittingLabel={t.creating}
          onSubmit={async (name, stepUp) => {
            const body: CreateAppPasswordRequest = { name, ...stepUp };
            const created = await apiFetch<CreatedAppPasswordResponse>("/auth/app-passwords", {
              method: "POST",
              json: body,
            });
            setDialog(null);
            setToken(created.token);
            await reload();
          }}
          onClose={() => {
            setDialog(null);
          }}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
      {dialog?.kind === "revoke" ? (
        <ConfirmDialog
          title={t.revokeTitle}
          body={t.revokeBody(dialog.appPassword.name)}
          cancelLabel={all.security.cancel}
          submitLabel={t.revokeSubmit}
          submittingLabel={t.revoking}
          onConfirm={async () => {
            await apiFetch(`/auth/app-passwords/${encodeURIComponent(dialog.appPassword.id)}`, {
              method: "DELETE",
            });
            setDialog(null);
            setNotice(t.revoked(dialog.appPassword.name));
            await reload();
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
