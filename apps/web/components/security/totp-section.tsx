"use client";

import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import type {
  RecoveryCodesResponse,
  TotpDisableRequest,
  TotpEnableRequest,
  TotpSetupResponse,
  TotpStatus,
} from "@cloud/shared";
import { apiFetch } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import {
  RECOVERY_FILE_NAME,
  compactCode,
  downloadText,
  groupSecret,
  recoveryFileText,
} from "../../lib/security";
import { useClipboard } from "../../lib/use-clipboard";
import { useForm } from "../../lib/use-form";
import { useResource } from "../../lib/use-resource";
import { Dialog } from "../dialog";
import { Field, FormAlert, SubmitButton } from "../form";

const LOW_CODES = 3;

async function loadStatus(): Promise<TotpStatus> {
  return apiFetch<TotpStatus>("/auth/totp");
}

function SetupDialog({
  setup,
  onEnabled,
  onClose,
  returnFocus,
}: {
  setup: TotpSetupResponse;
  onEnabled: (codes: string[]) => Promise<void>;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const t = useT().security;
  const form = useForm();
  const id = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = compactCode(code);
    if (!/^\d{6}$/.test(digits)) {
      form.fail(t.totp.codeInvalid, codeRef);
      return;
    }
    void form.submit(async () => {
      const body: TotpEnableRequest = { code: digits };
      const { recoveryCodes } = await apiFetch<RecoveryCodesResponse>("/auth/totp/enable", {
        method: "POST",
        json: body,
      });
      await onEnabled(recoveryCodes);
    });
  }

  return (
    <Dialog title={t.totp.setupTitle} onClose={onClose} returnFocus={returnFocus}>
      <p>{t.totp.setupIntro}</p>
      <Field
        id={`${id}-secret`}
        label={t.totp.secretLabel}
        className="secret"
        readOnly
        spellCheck={false}
        value={groupSecret(setup.secret)}
      />
      <p>
        <a href={setup.otpauthUrl}>{t.totp.openApp}</a>
      </p>
      <p className="note">{t.totp.openAppNote}</p>
      <form onSubmit={onSubmit} className="stack" noValidate>
        <Field
          id={`${id}-code`}
          label={t.totp.codeLabel}
          hint={t.totp.codeHint}
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          data-autofocus=""
          inputRef={codeRef}
          state={form}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            form.clear();
          }}
        />
        <FormAlert form={form} />
        <div className="row-actions">
          <SubmitButton busy={form.busy} label={t.totp.turnOn} busyLabel={t.totp.turningOn} />
          <button type="button" className="button button-quiet" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DisableDialog({
  onDisabled,
  onClose,
  returnFocus,
}: {
  onDisabled: () => Promise<void>;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const t = useT().security;
  const form = useForm();
  const id = useId();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.submit(async () => {
      const body: TotpDisableRequest = { password, code: compactCode(code) };
      await apiFetch("/auth/totp/disable", { method: "POST", json: body });
      await onDisabled();
    });
  }

  return (
    <Dialog title={t.totp.disableTitle} onClose={onClose} returnFocus={returnFocus}>
      <p>{t.totp.disableBody}</p>
      <form onSubmit={onSubmit} className="stack">
        <Field
          id={`${id}-password`}
          label={t.totp.passwordLabel}
          type="password"
          autoComplete="current-password"
          required
          data-autofocus=""
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <Field
          id={`${id}-code`}
          label={t.totp.codeOrRecoveryLabel}
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
          }}
        />
        <FormAlert form={form} />
        <div className="row-actions">
          <button type="submit" className="button button-danger" disabled={form.busy}>
            {form.busy ? t.totp.disabling : t.totp.disableSubmit}
          </button>
          <button type="button" className="button button-quiet" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useT().security.totp;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { status, copy } = useClipboard(t.copied, t.copyFailed);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="recovery-heading" className="callout stack">
      <h3 id="recovery-heading" ref={headingRef} tabIndex={-1}>
        {t.recoveryTitle}
      </h3>
      <p>{t.recoveryIntro}</p>
      <ul className="codes" aria-label={t.recoveryListLabel}>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            void copy(codes.join("\n"));
          }}
        >
          {t.copy}
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => {
            downloadText(RECOVERY_FILE_NAME, recoveryFileText(t.fileHeading, codes));
          }}
        >
          {t.download}
        </button>
        <button type="button" className="button button-quiet" onClick={onDone}>
          {t.saved}
        </button>
      </div>
      <p role="status" className="note">
        {status}
      </p>
    </section>
  );
}

type DialogState =
  | { kind: "setup"; setup: TotpSetupResponse; returnFocus: HTMLElement | null }
  | { kind: "disable"; returnFocus: HTMLElement | null };

export function TotpSection() {
  const all = useT();
  const t = all.security.totp;
  const { state, reload } = useResource(loadStatus);
  const setupForm = useForm();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState("");

  function onSetUp(button: HTMLElement) {
    setNotice("");
    void setupForm.submit(async () => {
      const setup = await apiFetch<TotpSetupResponse>("/auth/totp/setup", { method: "POST" });
      setDialog({ kind: "setup", setup, returnFocus: button });
    });
  }

  return (
    <section aria-labelledby="totp-heading" className="stack">
      <h2 id="totp-heading">{t.title}</h2>
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
        <>
          <p>
            <strong>{state.data.enabled ? t.statusOn : t.statusOff}</strong>
          </p>
          {state.data.enabled ? (
            <>
              <p>{t.codesLeft(state.data.recoveryCodesLeft)}</p>
              {state.data.recoveryCodesLeft < LOW_CODES ? (
                <p className="note">{t.codesLow}</p>
              ) : null}
              <div>
                <button
                  type="button"
                  className="button button-quiet button-danger-text"
                  onClick={(event) => {
                    setNotice("");
                    setDialog({ kind: "disable", returnFocus: event.currentTarget });
                  }}
                >
                  {t.turnOff}
                </button>
              </div>
            </>
          ) : (
            <div>
              <button
                type="button"
                className="button"
                disabled={setupForm.busy}
                aria-busy={setupForm.busy}
                onClick={(event) => {
                  onSetUp(event.currentTarget);
                }}
              >
                {setupForm.busy ? t.settingUp : t.setUp}
              </button>
            </div>
          )}
        </>
      ) : null}
      <FormAlert form={setupForm} />
      <p role="status" className="note">
        {notice}
      </p>

      {codes ? (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
          }}
        />
      ) : null}

      {dialog?.kind === "setup" ? (
        <SetupDialog
          setup={dialog.setup}
          onEnabled={async (fresh) => {
            setDialog(null);
            setCodes(fresh);
            setNotice(t.enabled);
            await reload();
          }}
          onClose={() => {
            setDialog(null);
          }}
          returnFocus={dialog.returnFocus}
        />
      ) : null}
      {dialog?.kind === "disable" ? (
        <DisableDialog
          onDisabled={async () => {
            setDialog(null);
            setCodes(null);
            setNotice(t.disabled);
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
