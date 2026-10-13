"use client";

import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import type { FileNode } from "@cloud/shared";
import { useFormat, useT } from "../../lib/i18n/provider";
import { createShare } from "../../lib/shares-api";
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  expiryDays,
  isExpiryChoice,
  passwordProblem,
  shareLink,
  type ExpiryChoice,
} from "../../lib/shares";
import { useForm } from "../../lib/use-form";
import { Dialog } from "../dialog";
import { FormAlert, SubmitButton } from "../form";
import { PasswordField } from "../password-field";

interface Created {
  link: string;
  expiresAt: string | null;
  hasPassword: boolean;
}

interface ShareDialogProps {
  node: FileNode;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

type CopyState = "idle" | "copied" | "failed";

function CreatedView({ created, onClose }: { created: Created; onClose: () => void }) {
  const t = useT().shares.share.created;
  const format = useFormat();
  const linkId = useId();
  const linkRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<CopyState>("idle");

  // The form that was focused is gone; the link is what the person came for.
  useEffect(() => {
    linkRef.current?.focus();
  }, []);

  async function onCopy() {
    linkRef.current?.select();
    try {
      await navigator.clipboard.writeText(created.link);
      setCopy("copied");
    } catch {
      // Clipboard access can be refused; the link is selected, so it can still be copied by hand.
      setCopy("failed");
    }
  }

  return (
    <>
      <div className="field">
        <label htmlFor={linkId}>{t.linkLabel}</label>
        <div className="input-row">
          <input
            id={linkId}
            ref={linkRef}
            type="text"
            readOnly
            value={created.link}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <button
            type="button"
            className="button"
            onClick={() => {
              void onCopy();
            }}
          >
            {t.copy}
          </button>
        </div>
        <p role="status" className="note">
          {copy === "copied" ? t.copied : copy === "failed" ? t.copyFailed : ""}
        </p>
      </div>
      <p className="callout">{t.once}</p>
      <ul className="plain-list note">
        <li>
          {created.expiresAt === null ? t.neverExpires : t.expires(format.date(created.expiresAt))}
        </li>
        {created.hasPassword ? <li>{t.protected}</li> : null}
        <li>{t.manage}</li>
      </ul>
      <div className="row-actions">
        <button type="button" className="button" onClick={onClose}>
          {t.done}
        </button>
      </div>
    </>
  );
}

/**
 * Creates a share link for a file or folder. The raw link is part of the create response and
 * is shown once, in this dialog; closing it discards the only copy the page ever has.
 */
export function ShareDialog({ node, onClose, returnFocus }: ShareDialogProps) {
  const t = useT().shares;
  const form = useForm();
  const expiryId = useId();
  const passwordId = useId();
  const dropBoxId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY);
  const [password, setPassword] = useState("");
  const [allowUpload, setAllowUpload] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordProblem(password) !== null) {
      form.fail(t.share.passwordTooShort, passwordRef);
      return;
    }
    void form.submit(async () => {
      const response = await createShare({
        fileId: node.id,
        expiresInDays: expiryDays(expiry),
        ...(password === "" ? {} : { password }),
        allowUpload: node.kind === "folder" && allowUpload,
      });
      setCreated({
        link: shareLink(window.location.origin, response.token),
        expiresAt: response.share.expiresAt,
        hasPassword: response.share.hasPassword,
      });
    });
  }

  return (
    <Dialog
      title={created ? t.share.created.title : t.share.title(node.name)}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {created ? (
        <CreatedView created={created} onClose={onClose} />
      ) : (
        <form onSubmit={submit} className="stack" noValidate>
          <div className="field">
            <label htmlFor={expiryId}>{t.share.expiryLabel}</label>
            <select
              id={expiryId}
              value={expiry}
              data-autofocus=""
              onChange={(event) => {
                if (isExpiryChoice(event.target.value)) {
                  setExpiry(event.target.value);
                }
              }}
            >
              {EXPIRY_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {t.share.expiry[choice]}
                </option>
              ))}
            </select>
          </div>
          <PasswordField
            id={passwordId}
            label={t.share.passwordLabel}
            hint={t.share.passwordHint}
            autoComplete="new-password"
            inputRef={passwordRef}
            state={form}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              form.clear();
            }}
          />
          {node.kind === "folder" ? (
            <div className="check">
              <input
                id={dropBoxId}
                type="checkbox"
                checked={allowUpload}
                onChange={(event) => {
                  setAllowUpload(event.target.checked);
                }}
              />
              <label htmlFor={dropBoxId}>{t.share.dropBox}</label>
            </div>
          ) : null}
          <FormAlert form={form} />
          <div className="row-actions">
            <SubmitButton busy={form.busy} label={t.share.submit} busyLabel={t.share.submitting} />
            <button type="button" className="button button-quiet" onClick={onClose}>
              {t.share.cancel}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
