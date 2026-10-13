/** Pure decisions behind the installable app: where the worker may run, and who sees which hint. */

export interface WorkerEnvironment {
  production: boolean;
  protocol: string;
  hostname: string;
  supported: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The worker is registered only in a production build, on https or on this machine. */
export function canRegisterServiceWorker(env: WorkerEnvironment): boolean {
  if (!env.production || !env.supported) {
    return false;
  }
  return env.protocol === "https:" || LOCAL_HOSTS.has(env.hostname);
}

/** Safari on an iPhone or iPad, where the only way to install is the Share sheet. */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  // iPadOS 13 and later says "Macintosh" but has a touch screen.
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) {
    return false;
  }
  // Chrome, Firefox, Edge, Opera and in-app browsers on iOS carry their own token.
  return (
    /Safari\//.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram/.test(userAgent)
  );
}

export type HintKind = "install" | "ios";

const KEY = "cloud:pwa-dismissed:";

/** Storage can be missing or throw (private mode, blocked site data); then nothing is remembered. */
export function wasDismissed(kind: HintKind): boolean {
  try {
    return window.localStorage.getItem(KEY + kind) === "1";
  } catch {
    return false;
  }
}

export function rememberDismissed(kind: HintKind): void {
  try {
    window.localStorage.setItem(KEY + kind, "1");
  } catch {
    // The hint then simply comes back next time.
  }
}

/** Chromium's install prompt event, which TypeScript's DOM types do not have. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Running as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  const navigatorWithFlag = navigator as Navigator & { standalone?: boolean };
  return (
    navigatorWithFlag.standalone === true || window.matchMedia("(display-mode: standalone)").matches
  );
}
