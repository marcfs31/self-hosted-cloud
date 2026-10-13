import { app, type BrowserWindow } from "electron";
import { loadTrayIcon } from "./icons.js";
import type { SettingsWindow } from "./settings-window.js";
import type { SyncController } from "./sync-controller.js";

export interface SmokeContext {
  assetsDir: string;
  settingsWindow: SettingsWindow;
  controller: SyncController;
  secureStorage: boolean;
}

/** In the page: what must hold for the settings window to be safe and working. */
const PAGE_CHECKS = `(async () => {
  const problems = [];
  const api = window.desktop;
  if (!api || typeof api.getState !== "function") problems.push("window.desktop is missing");
  else if (Object.keys(api).sort().join() !== "chooseFolder,getState,onStatus,saveConfig,testConnection")
    problems.push("window.desktop exposes " + Object.keys(api).join());
  if (typeof require !== "undefined") problems.push("require is visible to the page");
  if (typeof process !== "undefined") problems.push("process is visible to the page");
  if (typeof Buffer !== "undefined") problems.push("Buffer is visible to the page");
  for (const node of document.querySelectorAll("[data-i18n]"))
    if (!node.textContent || !node.textContent.trim()) problems.push("untranslated: " + node.dataset.i18n);
  if (!document.querySelector("form#form")) problems.push("form is missing");
  for (const label of document.querySelectorAll("label[for]"))
    if (!document.getElementById(label.htmlFor)) problems.push("label for a missing field: " + label.htmlFor);
  let evalBlocked = false;
  try { new Function("return 1")(); } catch { evalBlocked = true; }
  if (!evalBlocked) problems.push("the CSP lets the page evaluate strings");
  let fetched = true;
  try { await fetch("https://example.com/"); } catch { fetched = false; }
  if (fetched) problems.push("the page can reach the network");
  return { problems, lang: document.documentElement.lang, title: document.title, status: document.getElementById("status-text").textContent };
})()`;

function loaded(win: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    win.webContents.once("did-finish-load", () => {
      resolve();
    });
    win.webContents.once("did-fail-load", (_event, code, description) => {
      reject(new Error(`settings page failed to load: ${String(code)} ${description}`));
    });
  });
}

/**
 * `electron . --smoke`: starts the shell against a throw-away profile, loads the settings page
 * hidden, checks its security properties, prints "ok" and exits. Exit code 1 on any problem.
 */
export async function runSmoke(context: SmokeContext): Promise<never> {
  const timeout = setTimeout(() => {
    console.error("smoke failed: timed out");
    app.exit(1);
  }, 30_000);
  try {
    loadTrayIcon(context.assetsDir, process.platform);
    await context.controller.apply();
    if (context.controller.status.state !== "unconfigured") {
      throw new Error(`expected an unconfigured profile, got ${context.controller.status.state}`);
    }
    const win = context.settingsWindow.show({ visible: false });
    await loaded(win);
    // The page asks the main process for its state over IPC before the checks run.
    await win.webContents.executeJavaScript(
      `new Promise((r) => { const t = setInterval(() => { if (document.getElementById("status-text").textContent) { clearInterval(t); r(); } }, 50); })`,
    );
    const outcome = (await win.webContents.executeJavaScript(PAGE_CHECKS)) as {
      problems: string[];
      lang: string;
      title: string;
      status: string;
    };
    if (outcome.problems.length > 0) throw new Error(outcome.problems.join("; "));
    console.log(
      `ok locale=${outcome.lang} title="${outcome.title}" status="${outcome.status}" secureStorage=${String(context.secureStorage)}`,
    );
    clearTimeout(timeout);
    app.exit(0);
  } catch (err) {
    clearTimeout(timeout);
    console.error(`smoke failed: ${err instanceof Error ? err.message : String(err)}`);
    app.exit(1);
  }
  return new Promise<never>(() => undefined);
}
