"use client";

import { useEffect, useState } from "react";
import { useT } from "../../lib/i18n/provider";
import {
  canRegisterServiceWorker,
  isIosSafari,
  isStandalone,
  rememberDismissed,
  wasDismissed,
  type BeforeInstallPromptEvent,
  type HintKind,
} from "../../lib/pwa";

/**
 * Registers the service worker (production builds only) and shows the small bar at the foot of
 * the page: "Update available", the install button (Chromium) or the iOS install hint.
 */
export function PwaBar() {
  const t = useT().pwa;
  const [updateReady, setUpdateReady] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    const supported = "serviceWorker" in navigator;
    const allowed = canRegisterServiceWorker({
      production: process.env.NODE_ENV === "production",
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      supported,
    });
    if (!allowed) {
      return;
    }
    // A new worker takes over at once (skipWaiting + claim). When this page was already under
    // the old one, its scripts may be stale, so offer a reload. The first install is silent.
    let hadController = navigator.serviceWorker.controller !== null;
    const onControllerChange = () => {
      if (hadController) {
        setUpdateReady(true);
      }
      hadController = true;
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.register("/sw.js", { type: "module", scope: "/" }).catch(() => {
      // Without a worker the app still works; it just cannot be installed or show the offline page.
    });
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    if (isStandalone()) {
      return;
    }
    if (isIosSafari(navigator.userAgent, navigator.maxTouchPoints) && !wasDismissed("ios")) {
      setIosHint(true);
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      if (!wasDismissed("install")) {
        setInstallEvent(event as BeforeInstallPromptEvent);
      }
    };
    const onInstalled = () => {
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss(kind: HintKind) {
    rememberDismissed(kind);
    if (kind === "install") {
      setInstallEvent(null);
    } else {
      setIosHint(false);
    }
  }

  async function install(event: BeforeInstallPromptEvent) {
    setInstallEvent(null);
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      // The browser refused to show the prompt; the button is gone and the browser's own menu remains.
    }
  }

  const visible = updateReady || installEvent !== null || iosHint;
  return (
    <div className={visible ? "pwa-bar" : undefined}>
      <div role="status">
        {updateReady ? (
          <div className="pwa-notice">
            <p>{t.update.text}</p>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                window.location.reload();
              }}
            >
              {t.update.reload}
            </button>
          </div>
        ) : null}
      </div>
      {installEvent ? (
        <section aria-label={t.install.region} className="pwa-notice">
          <p>{t.install.text}</p>
          <div className="row-actions">
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                void install(installEvent);
              }}
            >
              {t.install.button}
            </button>
            <button
              type="button"
              className="button button-small button-quiet"
              onClick={() => {
                dismiss("install");
              }}
            >
              {t.install.dismiss}
            </button>
          </div>
        </section>
      ) : null}
      {iosHint ? (
        <section aria-label={t.ios.region} className="pwa-notice">
          <p>{t.ios.text}</p>
          <button
            type="button"
            className="button button-small button-quiet"
            onClick={() => {
              dismiss("ios");
            }}
          >
            {t.ios.dismiss}
          </button>
        </section>
      ) : null}
    </div>
  );
}
