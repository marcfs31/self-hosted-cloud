"use client";

import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { useState } from "react";
import type { Passkey, PasskeyList, RegisterPasskeyRequest } from "@cloud/shared";
import { apiFetch } from "../../lib/api";
import { useFormat, useT } from "../../lib/i18n/provider";
import { isAlreadyRegistered, isCancellation } from "../../lib/passkeys";
import { useResource } from "../../lib/use-resource";
import { ConfirmDialog } from "../confirm-dialog";
import { SecurityNameDialog } from "./name-dialog";
import { usePasskeySupport } from "./passkey-login-button";

async function loadPasskeys(): Promise<Passkey[]> {
  const { passkeys } = await apiFetch<PasskeyList>("/auth/passkeys");
  return passkeys;
}

type DialogState =
  | { kind: "add"; returnFocus: HTMLElement | null }
  | { kind: "remove"; passkey: Passkey; returnFocus: HTMLElement | null };

export function PasskeysSection() {
  const all = useT();
  const t = all.security.passkeys;
  const format = useFormat();
  const supported = usePasskeySupport();
  const { state, reload } = useResource(loadPasskeys);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState("");

  return (
    <section aria-labelledby="passkeys-heading" className="stack">
      <h2 id="passkeys-heading">{t.title}</h2>
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
              {state.data.map((passkey) => (
                <tr key={passkey.id}>
                  <td data-label={t.colName} className="cell-wrap">
                    {passkey.name}
                  </td>
                  <td data-label={t.colCreated}>{format.date(passkey.createdAt)}</td>
                  <td data-label={t.colLastUsed}>
                    {passkey.lastUsedAt === null
                      ? t.neverUsed
                      : format.dateTime(passkey.lastUsedAt)}
                  </td>
                  <td data-label={t.colActions}>
                    <button
                      type="button"
                      className="button button-quiet button-small button-danger-text"
                      aria-label={t.removeLabel(passkey.name)}
                      onClick={(event) => {
                        setDialog({ kind: "remove", passkey, returnFocus: event.currentTarget });
                      }}
                    >
                      {t.remove}
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
      {supported ? (
        <div>
          <button
            type="button"
            className="button"
            onClick={(event) => {
              setNotice("");
              setDialog({ kind: "add", returnFocus: event.currentTarget });
            }}
          >
            {t.add}
          </button>
        </div>
      ) : (
        <p className="note">{t.unsupported}</p>
      )}

      {dialog?.kind === "add" ? (
        <SecurityNameDialog
          title={t.addTitle}
          label={t.nameLabel}
          hint={t.nameHint}
          requiredMessage={t.nameRequired}
          submitLabel={t.continue}
          submittingLabel={t.waiting}
          onSubmit={async (name, fail) => {
            const optionsJSON = await apiFetch<PublicKeyCredentialCreationOptionsJSON>(
              "/auth/passkeys/register/options",
              { method: "POST" },
            );
            let response;
            try {
              response = await startRegistration({ optionsJSON });
            } catch (e) {
              // Dismissing the browser's prompt is a choice, not a failure: stay quiet.
              if (!isCancellation(e)) {
                fail(isAlreadyRegistered(e) ? t.alreadyRegistered : t.failed);
              }
              return;
            }
            const body: RegisterPasskeyRequest = { name, response: { ...response } };
            const created = await apiFetch<Passkey>("/auth/passkeys/register/verify", {
              method: "POST",
              json: body,
            });
            setDialog(null);
            setNotice(t.added(created.name));
            await reload();
          }}
          onClose={() => {
            setDialog(null);
          }}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
      {dialog?.kind === "remove" ? (
        <ConfirmDialog
          title={t.removeTitle}
          body={t.removeBody(dialog.passkey.name)}
          cancelLabel={all.security.cancel}
          submitLabel={t.removeSubmit}
          submittingLabel={t.removing}
          onConfirm={async () => {
            await apiFetch(`/auth/passkeys/${encodeURIComponent(dialog.passkey.id)}`, {
              method: "DELETE",
            });
            setDialog(null);
            setNotice(t.removed(dialog.passkey.name));
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
