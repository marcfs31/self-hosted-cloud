"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { useSyncExternalStore } from "react";
import type { PasskeyLoginRequest } from "@cloud/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { useT } from "../../lib/i18n/provider";
import { isCancellation } from "../../lib/passkeys";
import type { FormState } from "../../lib/use-form";

const never = () => () => undefined;

/** Whether this browser can do passkeys; false while rendering on the server. */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(never, browserSupportsWebAuthn, () => false);
}

/** "Sign in with a passkey": options → the browser's prompt → verify. Cancelling is silent. */
export function PasskeyLoginButton({
  form,
  onSignedIn,
}: {
  form: FormState;
  onSignedIn: () => void;
}) {
  const t = useT().security.login;
  const supported = usePasskeySupport();
  if (!supported) {
    return null;
  }

  function onClick() {
    void form.submit(async () => {
      const optionsJSON = await apiFetch<PublicKeyCredentialRequestOptionsJSON>(
        "/auth/passkeys/login/options",
        { method: "POST" },
      );
      let response;
      try {
        response = await startAuthentication({ optionsJSON });
      } catch (e) {
        if (!isCancellation(e)) {
          form.fail(t.passkeyFailed);
        }
        return;
      }
      try {
        const body: PasskeyLoginRequest = { response: { ...response } };
        await apiFetch("/auth/passkeys/login/verify", { method: "POST", json: body });
      } catch (e) {
        if (e instanceof ApiError && e.code === "invalid_credentials") {
          form.fail(t.passkeyFailed);
          return;
        }
        throw e;
      }
      onSignedIn();
    });
  }

  return (
    <>
      <p className="divider" aria-hidden="true">
        {t.divider}
      </p>
      <button
        type="button"
        className="button button-quiet"
        disabled={form.busy}
        aria-busy={form.busy}
        onClick={onClick}
      >
        {form.busy ? t.passkeyWaiting : t.passkeyButton}
      </button>
    </>
  );
}
